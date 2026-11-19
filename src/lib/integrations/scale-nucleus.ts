import type { VerifierAssessment, VisionAssessment } from "../schemas";
import type { CostEstimate } from "../costing";
import type { ConfidenceResult } from "../confidence";
import { ROUTING_THRESHOLDS } from "../confidence";
import { PROMPT_VERSION } from "../prompts";
import type { CurationMetadata } from "./types";

/**
 * Scale Nucleus slice curation (plan §8.2): every assessment is tagged with
 * structured failure-slice metadata so systematic failures automatically
 * populate regression slices for prompt/model iteration.
 */

export interface SliceInput {
  assessment: VisionAssessment;
  verifier: VerifierAssessment | null;
  confidence: ConfidenceResult;
  isTotalLossLikely: boolean;
  modelTier: string;
  primaryModel: string;
  verifierModel: string | null;
}

/**
 * Deterministic slice tags. `slice:*` tags mark failure modes worth curating;
 * `model_tier` / `provider:*` / `prompt_version` support stratified analysis.
 */
export function buildSliceTags(input: SliceInput): string[] {
  const { assessment, verifier, confidence } = input;
  const tags: string[] = [];

  const idDisagreement =
    verifier !== null &&
    (confidence.agreement === null ||
      confidence.agreement < ROUTING_THRESHOLDS.agreement ||
      confidence.disagreements.some((d) => d.startsWith("make:") || d.startsWith("model:")));
  if (verifier !== null && idDisagreement) {
    tags.push("slice:vehicle_id_disagreement");
  }

  if (assessment.has_preexisting_wear_only) {
    tags.push("slice:preexisting_wear");
  }
  if (assessment.hidden_damage_risk === "high") {
    tags.push("slice:high_hidden_damage_risk");
  }
  if (assessment.image_quality === "poor" || assessment.image_quality === "unusable") {
    tags.push("slice:low_image_quality");
  }
  if (assessment.has_structural_indicators) {
    tags.push("slice:structural_flag");
  }
  if (assessment.has_airbag_deployment) {
    tags.push("slice:airbag_deployment");
  }
  if (input.isTotalLossLikely) {
    tags.push("slice:total_loss_likely");
  }
  if (!assessment.is_single_vehicle) {
    tags.push("slice:multi_vehicle_scene");
  }

  tags.push(`model_tier:${input.modelTier}`);
  tags.push(`provider:primary:${input.primaryModel}`);
  if (input.verifierModel) {
    tags.push(`provider:verifier:${input.verifierModel}`);
  }
  tags.push(`prompt_version:${PROMPT_VERSION}`);
  tags.push(`route:${confidence.route}`);

  return tags;
}

/** Dataset curation metadata for Nucleus (dataset id, slices, review action). */
export function buildCurationMetadata(
  input: SliceInput & {
    estimate: Pick<CostEstimate, "totals" | "rate_card_version">;
  },
): CurationMetadata {
  const { confidence } = input;

  // Failure slices are queued for regression; clean AUTO_APPROVEs with no
  // slice flags are golden-set promotion candidates.
  const failureSlices = buildSliceTags(input).filter((t) =>
    t.startsWith("slice:"),
  );
  const suggestedAction: CurationMetadata["suggested_action"] =
    confidence.route === "ESCALATE" && failureSlices.length > 0
      ? "add_to_regression_slice"
      : confidence.route === "AUTO_APPROVE" && failureSlices.length === 0
        ? "promote_to_golden_set"
        : "none";

  const reviewPriority: CurationMetadata["review_priority"] =
    confidence.route === "REJECT"
      ? "low"
      : input.assessment.has_structural_indicators ||
          input.assessment.hidden_damage_risk === "high"
        ? "high"
        : "medium";

  return {
    dataset: process.env.NUCLEUS_DATASET ?? "auto-claims-demo",
    created_at: new Date().toISOString(),
    slice_tags: buildSliceTags(input),
    route: confidence.route,
    suggested_action: suggestedAction,
    review_priority: reviewPriority,
    models: { primary: input.primaryModel, verifier: input.verifierModel },
    estimate_summary: {
      point_usd: input.estimate.totals.point_usd,
      rate_card_version: input.estimate.rate_card_version,
    },
    confidence: {
      overall: confidence.overall,
      agreement: confidence.agreement,
      route: confidence.route,
    },
  };
}
