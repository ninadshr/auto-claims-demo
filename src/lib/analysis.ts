import { createHash } from "node:crypto";
import type { VerifierAssessment, VisionAssessment } from "./schemas";
import type { Region } from "./rate-card";
import { computeCostEstimate, type CostEstimate } from "./costing";
import { computeConfidence, type ConfidenceResult } from "./confidence";
import { PROMPT_VERSION } from "./prompts";
import {
  fireworksConfigured,
  fireworksVerifyVehicleId,
  runOpenWeightEnsemble,
} from "./providers/fireworks";
import { frontierAssess } from "./providers/frontier";
import type {
  EnsembleResult,
  ModelTier,
  TokenUsage,
} from "./providers/types";
import { buildSliceTags, buildCurationMetadata } from "./integrations/scale-nucleus";
import type { CurationMetadata } from "./integrations/types";
import {
  buildEscalationPayload,
  submitEscalation,
} from "./integrations/scale-api";
import type { EscalationOutcome } from "./integrations/scale-api";

/**
 * The full STP pipeline (plan §5), shared by POST /api/analyze and the live
 * golden-set evaluation in POST /api/eval:
 *   image bytes → primary + verifier vision (Promise.allSettled) → zod
 *   validation → deterministic costing → confidence-gated routing → Scale
 *   flywheel adapters → structured result.
 *
 * Invariants enforced here: model output is zod-validated before costing; all
 * dollar math happens in costing.ts; the verifier degrades gracefully.
 */

// ---------------------------------------------------------------------------
// Result types (the shape of POST /api/analyze's 200 response)
// ---------------------------------------------------------------------------

export interface ModelTelemetry {
  model: string;
  provider: string;
  latency_ms: number;
  usage: TokenUsage | null;
  reasoning: string | null;
}

export interface VerifierTelemetry extends ModelTelemetry {
  assessment: VerifierAssessment;
}

export interface AnalysisResult {
  request_id: string;
  image_sha256: string;
  prompt_version: string;
  model_tier: ModelTier;
  region: Region;
  primary: ModelTelemetry;
  verifier: VerifierTelemetry | null;
  verifier_status: "ok" | "degraded" | "skipped";
  verifier_error: string | null;
  assessment: VisionAssessment;
  estimate: CostEstimate;
  confidence: ConfidenceResult;
  route: ConfidenceResult["route"];
  routing_reasons: string[];
  scale: {
    escalation: EscalationOutcome | null;
    slice_tags: string[];
    curation: CurationMetadata;
  };
}

// ---------------------------------------------------------------------------
// Errors (mapped to HTTP statuses by the routes)
// ---------------------------------------------------------------------------

/** A 503-class configuration problem (e.g. FIREWORKS_API_KEY missing). */
export class UpstreamError extends Error {}

/** Primary vision model failed; the verifier error is carried alongside. */
export class PrimaryModelError extends Error {
  constructor(
    public primaryError: string | null,
    public verifierError: string | null,
  ) {
    super("Primary vision model call failed");
  }
}

// ---------------------------------------------------------------------------
// Model ensemble
// ---------------------------------------------------------------------------

async function runModelEnsemble(
  modelTier: ModelTier,
  imageDataUri: string,
): Promise<EnsembleResult> {
  if (modelTier === "open-weight") {
    if (!fireworksConfigured()) {
      throw new UpstreamError(
        "FIREWORKS_API_KEY is not configured — cannot run the open-weight tier",
      );
    }
    // Primary + verifier run concurrently inside Promise.allSettled.
    return runOpenWeightEnsemble(imageDataUri);
  }

  // Frontier primary + open-weight verifier, concurrently — the verifier
  // stays on the independent open-weight family so the cross-check spans
  // model families even in frontier mode.
  const [primaryRes, verifierRes] = await Promise.allSettled([
    frontierAssess(modelTier, imageDataUri),
    fireworksConfigured()
      ? fireworksVerifyVehicleId(imageDataUri)
      : Promise.reject(new Error("FIREWORKS_API_KEY not set — verifier skipped")),
  ]);
  return {
    primary: primaryRes.status === "fulfilled" ? primaryRes.value : null,
    primaryError:
      primaryRes.status === "rejected"
        ? primaryRes.reason instanceof Error
          ? primaryRes.reason.message
          : String(primaryRes.reason)
        : null,
    verifier: verifierRes.status === "fulfilled" ? verifierRes.value : null,
    verifierError:
      verifierRes.status === "rejected"
        ? verifierRes.reason instanceof Error
          ? verifierRes.reason.message
          : String(verifierRes.reason)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export interface AssessImageInput {
  bytes: Uint8Array;
  mediaType: string;
  modelTier: ModelTier;
  region: Region;
  acvUsd?: number;
  requestId: string;
}

export function toDataUri(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Run the full pipeline on validated image bytes. */
export async function assessImage(
  input: AssessImageInput,
): Promise<AnalysisResult> {
  const imageSha256 = createHash("sha256")
    .update(input.bytes)
    .digest("hex");
  const imageDataUri = toDataUri(input.bytes, input.mediaType);

  // --- Concurrent primary + verifier vision -------------------------------
  const ensemble = await runModelEnsemble(input.modelTier, imageDataUri);
  if (!ensemble.primary) {
    throw new PrimaryModelError(ensemble.primaryError, ensemble.verifierError);
  }
  const primary = ensemble.primary;
  const verifier: VerifierAssessment | null = ensemble.verifier?.data ?? null;

  // --- Deterministic costing + confidence-gated routing -------------------
  const estimate = computeCostEstimate({
    assessment: primary.data,
    region: input.region,
    acvUsd: input.acvUsd,
  });
  const confidence = computeConfidence({
    assessment: primary.data,
    verifier,
    isTotalLossLikely: estimate.is_total_loss_likely,
  });

  // --- Scale AI flywheel adapters -----------------------------------------
  const sliceInput = {
    assessment: primary.data,
    verifier,
    confidence,
    isTotalLossLikely: estimate.is_total_loss_likely,
    modelTier: input.modelTier,
    primaryModel: primary.model,
    verifierModel: ensemble.verifier?.model ?? null,
  };
  const sliceTags = buildSliceTags(sliceInput);
  const curation = buildCurationMetadata({ ...sliceInput, estimate });

  let escalation: EscalationOutcome | null = null;
  if (confidence.route === "ESCALATE") {
    const payload = buildEscalationPayload({
      ...sliceInput,
      confidence,
      estimate,
      imageSha256,
      mediaType: input.mediaType,
      promptVersion: PROMPT_VERSION,
      sliceTags,
    });
    escalation = await submitEscalation(payload);
  }

  return {
    request_id: input.requestId,
    image_sha256: imageSha256,
    prompt_version: PROMPT_VERSION,
    model_tier: input.modelTier,
    region: input.region,
    primary: {
      model: primary.model,
      provider: primary.provider,
      latency_ms: primary.latency_ms,
      usage: primary.usage,
      reasoning: primary.reasoning,
    },
    verifier: ensemble.verifier
      ? {
          model: ensemble.verifier.model,
          provider: ensemble.verifier.provider,
          latency_ms: ensemble.verifier.latency_ms,
          usage: ensemble.verifier.usage,
          reasoning: ensemble.verifier.reasoning,
          assessment: ensemble.verifier.data,
        }
      : null,
    verifier_status: ensemble.verifier
      ? "ok"
      : ensemble.verifierError
        ? "degraded"
        : "skipped",
    verifier_error: ensemble.verifierError,
    assessment: primary.data,
    estimate,
    confidence,
    route: confidence.route,
    routing_reasons: confidence.routing_reasons,
    scale: {
      escalation,
      slice_tags: sliceTags,
      curation,
    },
  };
}
