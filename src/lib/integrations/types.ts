import type { Panel, Operation, Severity } from "../schemas";
import type { CostEstimate } from "../costing";
import type { ConfidenceResult } from "../confidence";

/**
 * Scale AI flywheel adapter interfaces (Invariant 5): the demo runs 100%
 * standalone by persisting structured payloads locally, and goes live the
 * moment SCALE_API_KEY / NUCLEUS_API_KEY are configured. Zero hard dependency.
 */

/** The labeling ontology human annotators score against (closed enums). */
export interface AnnotationOntology {
  panels: Panel[];
  severities: Severity[];
  operations: Operation[];
}

/** VLM prelabel for one damage item, shown to the human as a hypothesis. */
export interface HypothesisAnnotation {
  panel: Panel;
  damage_type: string;
  severity: Severity;
  affected_area_pct: number;
  recommended_operation: Operation;
  paint_type: string;
  confidence: number;
  notes: string;
  source: "primary_vlm";
}

export interface VehicleHypothesis {
  make: string | null;
  model: string | null;
  colour: string | null;
  vehicle_class: string;
  source: "primary_vlm" | "verifier";
}

/** Scale API human-labeling escalation task payload (built on ESCALATE). */
export interface EscalationPayload {
  task_id: string;
  created_at: string;
  /** Image reference by content hash — never an inline base64 blob. */
  attachment: {
    type: "image";
    sha256: string;
    media_type: string | null;
  };
  ontology: AnnotationOntology;
  hypothesis_annotations: HypothesisAnnotation[];
  vehicle_hypothesis: VehicleHypothesis | null;
  verifier_hypothesis: VehicleHypothesis | null;
  disagreements: string[];
  escalation_reasons: string[];
  estimate_summary: {
    point_usd: number;
    low_usd: number;
    high_usd: number;
    rate_card_version: string;
  };
  metadata: {
    prompt_version: string;
    primary_model: string;
    verifier_model: string | null;
    model_tier: string;
    slice_tags: string[];
  };
}

export type EscalationStatus =
  | "SUBMITTED"
  | "SUBMIT_FAILED"
  | "SIMULATED_LOCAL";

export interface EscalationOutcome {
  status: EscalationStatus;
  task_id: string;
  /** Live endpoint used, or null in local demo mode. */
  endpoint: string | null;
  /** Raw provider response when submitting live, else null. */
  response: unknown;
  error: string | null;
  payload: EscalationPayload;
}

/** Scale Nucleus slice-curation metadata attached to every assessment. */
export interface CurationMetadata {
  dataset: string;
  created_at: string;
  slice_tags: string[];
  route: string;
  suggested_action: "add_to_regression_slice" | "promote_to_golden_set" | "none";
  review_priority: "high" | "medium" | "low";
  models: { primary: string; verifier: string | null };
  estimate_summary: Pick<
    CostEstimate["totals"],
    "point_usd"
  > & { rate_card_version: string };
  confidence: Pick<
    ConfidenceResult,
    "overall" | "agreement" | "route"
  >;
}
