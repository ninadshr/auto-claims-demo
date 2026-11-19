import type {
  BaselineMetrics,
  GoldenRow,
  ThresholdPoint,
} from "./metrics";
import type { ModelTierInfo } from "../lib/providers/types";

/** Shape of GET /api/eval (and the shared part of POST /api/eval). */
export interface EvalResponse {
  prompt_version: string;
  default_threshold: number;
  model_tiers: ModelTierInfo[];
  golden_set: GoldenRow[];
  baseline: BaselineMetrics;
  sweep: ThresholdPoint[];
  note?: string;
  recorded_at?: string;
}

export interface LiveSampleSummary {
  id: string;
  ok: boolean;
  error: string | null;
  route: string;
  overall: number;
  agreement: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
}

/** Shape of POST /api/eval — golden-set metrics recomputed from live runs. */
export interface LiveEvalResponse extends EvalResponse {
  mode: "live";
  ran_at: string;
  model_tier: string;
  region: string;
  per_sample: LiveSampleSummary[];
}
