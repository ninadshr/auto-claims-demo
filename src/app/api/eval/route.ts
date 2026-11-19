import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import goldenSetJson from "@/eval/golden-set.json";
import {
  GoldenRowSchema,
  baselineMetrics,
  sweepThresholds,
  type GoldenRow,
} from "@/eval/metrics";
import {
  UpstreamError,
  assessImage,
} from "@/lib/analysis";
import { estimateInferenceCostUsd } from "@/lib/providers/pricing";
import { openWeightTierInfo } from "@/lib/providers/fireworks";
import { listFrontierTiers } from "@/lib/providers/frontier";
import { PROMPT_VERSION } from "@/lib/prompts";
import { ROUTING_THRESHOLDS } from "@/lib/confidence";
import type { ModelTier } from "@/lib/providers/types";
import type { Region } from "@/lib/rate-card";
import { REGIONS } from "@/lib/rate-card";

/**
 * GET  /api/eval — pre-computed golden-set baseline + full threshold sweep +
 * model-tier availability, so the panel can inspect threshold trade-offs
 * instantly (no live VLM calls).
 * POST /api/eval — re-run the live ensemble on the 4 sample images on demand
 * (~2 min) and recompute the same metrics against ground truth.
 */

// cacheComponents forbids an explicit `export const runtime`; Node.js is the
// route-handler default and is required for the fs import below.
export const maxDuration = 300;

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function loadGoldenSet(): { rows: GoldenRow[]; note: string; recordedAt: string } {
  const parsed = GoldenRowSchema.array().safeParse(goldenSetJson.rows);
  if (!parsed.success) {
    throw new Error(`golden-set.json failed validation: ${parsed.error.message}`);
  }
  return {
    rows: parsed.data,
    note: goldenSetJson.note,
    recordedAt: goldenSetJson.recorded_at,
  };
}

function evalResponse(rows: GoldenRow[]) {
  return {
    prompt_version: PROMPT_VERSION,
    default_threshold: ROUTING_THRESHOLDS.overall,
    model_tiers: [openWeightTierInfo(), ...listFrontierTiers()],
    golden_set: rows,
    baseline: baselineMetrics(rows),
    sweep: sweepThresholds(rows),
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const { rows, note, recordedAt } = loadGoldenSet();
    return NextResponse.json({ ...evalResponse(rows), note, recorded_at: recordedAt });
  } catch (err) {
    console.error("eval GET failure:", err);
    return NextResponse.json(
      { error: "Failed to load golden set", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface LiveSampleSummary {
  id: string;
  ok: boolean;
  error: string | null;
  route: string;
  overall: number;
  agreement: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
}

/** Map a live AnalysisResult into the golden-set prediction shape. */
function livePrediction(row: GoldenRow, result: Awaited<ReturnType<typeof assessImage>>): GoldenRow["prediction"] {
  const a = result.assessment;
  return {
    is_vehicle: a.is_vehicle,
    image_quality: a.image_quality,
    has_airbag_deployment: a.has_airbag_deployment,
    has_structural_indicators: a.has_structural_indicators,
    is_total_loss_likely: result.estimate.is_total_loss_likely,
    has_preexisting_wear_only: a.has_preexisting_wear_only,
    make: a.vehicle.make,
    model: a.vehicle.model,
    colour: a.vehicle.colour,
    vehicle_class: a.vehicle.vehicle_class,
    verifier_make: result.verifier?.assessment.make ?? null,
    verifier_model: result.verifier?.assessment.model ?? null,
    agreement: result.confidence.agreement,
    overall: result.confidence.overall,
    vehicle_id_score: result.confidence.vehicle_id_score,
    damage_score: result.confidence.damage_score,
    cost_score: result.confidence.cost_score,
    damage_items: a.damage_items.map((item) => ({
      panel: item.panel,
      severity: item.severity,
      operation: item.recommended_operation,
    })),
    latency_ms: result.primary.latency_ms,
    prompt_tokens: result.primary.usage?.prompt_tokens ?? null,
    completion_tokens: result.primary.usage?.completion_tokens ?? null,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      modelTier?: unknown;
      region?: unknown;
    };
    const modelTier: ModelTier =
      body.modelTier === "anthropic" || body.modelTier === "openai" || body.modelTier === "gemini"
        ? body.modelTier
        : "open-weight";
    const region: Region =
      typeof body.region === "string" && (REGIONS as readonly string[]).includes(body.region)
        ? (body.region as Region)
        : "US_NATIONAL";

    const { rows } = loadGoldenSet();
    const liveRows = rows.filter((r) => !r.simulated && r.image);

    // All 4 live samples run concurrently; each failure degrades to the
    // recorded baseline prediction and is reported in per_sample.
    const settled = await Promise.allSettled(
      liveRows.map(async (row) => {
        const filePath = path.join(process.cwd(), "public", row.image!);
        const bytes = new Uint8Array(await readFile(filePath));
        const mediaType = MEDIA_TYPE_BY_EXT[path.extname(row.image!).toLowerCase()];
        if (!mediaType) {
          throw new Error(`Unsupported sample extension for ${row.image}`);
        }
        return assessImage({
          bytes,
          mediaType,
          modelTier,
          region,
          requestId: `eval_${row.id}`,
        });
      }),
    );

    const perSample: LiveSampleSummary[] = [];
    const updatedRows = rows.map((row) => {
      if (row.simulated || !row.image) return row;
      const index = liveRows.findIndex((r) => r.id === row.id);
      const outcome = settled[index];
      if (outcome.status !== "fulfilled") {
        perSample.push({
          id: row.id,
          ok: false,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          route: "—",
          overall: 0,
          agreement: null,
          latency_ms: null,
          cost_usd: null,
        });
        return row; // keep the recorded baseline prediction
      }
      const result = outcome.value;
      perSample.push({
        id: row.id,
        ok: true,
        error: null,
        route: result.route,
        overall: result.confidence.overall,
        agreement: result.confidence.agreement,
        latency_ms: result.primary.latency_ms,
        cost_usd: estimateInferenceCostUsd([
          { model: result.primary.model, usage: result.primary.usage },
          ...(result.verifier
            ? [{ model: result.verifier.model, usage: result.verifier.usage }]
            : []),
        ]),
      });
      return { ...row, prediction: livePrediction(row, result) };
    });

    return NextResponse.json({
      ...evalResponse(updatedRows),
      mode: "live",
      ran_at: new Date().toISOString(),
      model_tier: modelTier,
      region,
      per_sample: perSample,
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("eval POST failure:", err);
    return NextResponse.json(
      {
        error: "Live evaluation failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
