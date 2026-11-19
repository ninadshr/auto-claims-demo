import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { OPERATIONS, PANELS, SEVERITIES } from "../schemas";
import type { VerifierAssessment, VisionAssessment } from "../schemas";
import type { CostEstimate } from "../costing";
import type { ConfidenceResult } from "../confidence";
import type {
  EscalationOutcome,
  EscalationPayload,
  HypothesisAnnotation,
  VehicleHypothesis,
} from "./types";

export type { EscalationOutcome, EscalationPayload } from "./types";

/**
 * Scale API human-in-the-loop escalation (plan §8.2).
 *
 * When a claim routes to ESCALATE, we build a structured labeling task whose
 * ontology is exactly the app's closed enums and whose hypotheses are the
 * VLM's prelabels (with disagreement flags for the verifier diff). Live
 * submission requires SCALE_API_KEY; otherwise the payload is appended to
 * `.local_store/escalations.jsonl` and surfaced in the Scale Flywheel
 * Inspector drawer with status "SIMULATED_LOCAL".
 */

const LOCAL_STORE_DIR = ".local_store";
const LOCAL_ESCALATIONS_FILE = "escalations.jsonl";

export interface BuildEscalationInput {
  assessment: VisionAssessment;
  verifier: VerifierAssessment | null;
  verifierModel: string | null;
  confidence: ConfidenceResult;
  estimate: CostEstimate;
  imageSha256: string;
  mediaType: string | null;
  promptVersion: string;
  primaryModel: string;
  modelTier: string;
  sliceTags: string[];
}

function toVehicleHypothesis(
  vehicle: VisionAssessment["vehicle"],
  source: VehicleHypothesis["source"],
): VehicleHypothesis {
  return {
    make: vehicle.make,
    model: vehicle.model,
    colour: vehicle.colour,
    vehicle_class: vehicle.vehicle_class,
    source,
  };
}

/** Build the Scale API task payload for an ESCALATE-routed claim. */
export function buildEscalationPayload(
  input: BuildEscalationInput,
): EscalationPayload {
  const hypothesisAnnotations: HypothesisAnnotation[] =
    input.assessment.damage_items.map((item) => ({
      panel: item.panel,
      damage_type: item.damage_type,
      severity: item.severity,
      affected_area_pct: item.affected_area_pct,
      recommended_operation: item.recommended_operation,
      paint_type: item.paint_type,
      confidence: item.confidence,
      notes: item.notes,
      source: "primary_vlm",
    }));

  return {
    task_id: `esc_${randomUUID()}`,
    created_at: new Date().toISOString(),
    attachment: {
      type: "image",
      sha256: input.imageSha256,
      media_type: input.mediaType,
    },
    ontology: {
      panels: [...PANELS],
      severities: [...SEVERITIES],
      operations: [...OPERATIONS],
    },
    hypothesis_annotations: hypothesisAnnotations,
    vehicle_hypothesis: input.assessment.is_vehicle
      ? toVehicleHypothesis(input.assessment.vehicle, "primary_vlm")
      : null,
    verifier_hypothesis: input.verifier
      ? {
          make: input.verifier.make,
          model: input.verifier.model,
          colour: input.verifier.colour,
          vehicle_class: input.verifier.vehicle_class,
          source: "verifier",
        }
      : null,
    disagreements: input.confidence.disagreements,
    escalation_reasons: input.confidence.routing_reasons,
    estimate_summary: {
      point_usd: input.estimate.totals.point_usd,
      low_usd: input.estimate.uncertainty.low_usd,
      high_usd: input.estimate.uncertainty.high_usd,
      rate_card_version: input.estimate.rate_card_version,
    },
    metadata: {
      prompt_version: input.promptVersion,
      primary_model: input.primaryModel,
      verifier_model: input.verifierModel,
      model_tier: input.modelTier,
      slice_tags: input.sliceTags,
    },
  };
}

/**
 * Submit the escalation: live via Scale API when SCALE_API_KEY is set,
 * otherwise persist locally for the demo drawer. Never throws — a flywheel
 * sink failure must not break the claims pipeline.
 */
export async function submitEscalation(
  payload: EscalationPayload,
): Promise<EscalationOutcome> {
  const apiKey = process.env.SCALE_API_KEY;

  if (apiKey) {
    const endpoint =
      process.env.SCALE_ESCALATION_ENDPOINT ?? "https://api.scale.com/v1/task";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          // Scale API authenticates with the key as the basic-auth username.
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      if (!response.ok) {
        return {
          status: "SUBMIT_FAILED",
          task_id: payload.task_id,
          endpoint,
          response: null,
          error: `Scale API ${response.status}: ${body.slice(0, 300)}`,
          payload,
        };
      }
      return {
        status: "SUBMITTED",
        task_id: payload.task_id,
        endpoint,
        response: JSON.parse(body) as unknown,
        error: null,
        payload,
      };
    } catch (err) {
      return {
        status: "SUBMIT_FAILED",
        task_id: payload.task_id,
        endpoint,
        response: null,
        error: err instanceof Error ? err.message : String(err),
        payload,
      };
    }
  }

  // Local demo mode: append-only JSONL store for the Flywheel Inspector.
  try {
    const storeDir = path.join(process.cwd(), LOCAL_STORE_DIR);
    await mkdir(storeDir, { recursive: true });
    await appendFile(
      path.join(storeDir, LOCAL_ESCALATIONS_FILE),
      `${JSON.stringify(payload)}\n`,
      "utf8",
    );
  } catch (err) {
    // Persisted payload is still returned inline for the UI drawer.
    console.error("Failed to persist local escalation:", err);
  }

  return {
    status: "SIMULATED_LOCAL",
    task_id: payload.task_id,
    endpoint: null,
    response: null,
    error: null,
    payload,
  };
}
