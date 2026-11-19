import type { VerifierAssessment, VisionAssessment } from "../schemas";

/**
 * Unified provider interface (Invariant 2): open-weight (Fireworks) and
 * frontier (Anthropic / OpenAI / Gemini) models sit behind the same types so
 * the analyze route and the UI Model Strategy selector are model-agnostic.
 */

export type ModelTier = "open-weight" | "anthropic" | "openai" | "gemini";

export const MODEL_TIERS: ModelTier[] = [
  "open-weight",
  "anthropic",
  "openai",
  "gemini",
];

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number | null;
  total_tokens?: number;
}

/** One completed model call: parsed + zod-validated output plus telemetry. */
export interface VisionCallResult<T> {
  data: T;
  /** Provider label, e.g. "fireworks" or "anthropic". */
  provider: string;
  /** Concrete model id that produced the output. */
  model: string;
  latency_ms: number;
  usage: TokenUsage | null;
  /** Raw chain-of-thought / reasoning trace, surfaced in the UI drawer. */
  reasoning: string | null;
}

export type PrimaryCall = VisionCallResult<VisionAssessment>;
export type VerifierCall = VisionCallResult<VerifierAssessment>;

/**
 * Concurrent primary + verifier run. The verifier is always the independent
 * open-weight model (even when a frontier primary is selected) so the
 * cross-model check spans model families. Verifier failure degrades
 * gracefully — the primary result is still returned.
 */
export interface EnsembleResult {
  primary: PrimaryCall | null;
  primaryError: string | null;
  verifier: VerifierCall | null;
  verifierError: string | null;
}

/** Availability metadata for the UI's Model Strategy selector. */
export interface ModelTierInfo {
  tier: ModelTier;
  label: string;
  model: string;
  provider: string;
  available: boolean;
  reason: string;
}

/** Split a base64 image data URI into its media type and raw payload. */
export function parseImageDataUri(
  dataUri: string,
): { mediaType: string; base64: string } {
  const match = /^data:(image\/[a-z.+]+);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUri,
  );
  if (!match) {
    throw new Error("Invalid image data URI");
  }
  return { mediaType: match[1], base64: match[2] };
}

/** Extract the first JSON object from model output that may be fenced or prefixed. */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost brace span for models that pad the JSON.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model output contained no parseable JSON object");
  }
}
