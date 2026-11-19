import {
  VerifierAssessmentSchema,
  VisionAssessmentSchema,
  verifierAssessmentJsonSchema,
  visionAssessmentJsonSchema,
} from "../schemas";
import {
  APPRAISER_SYSTEM_PROMPT,
  APPRAISER_USER_INSTRUCTION,
  VERIFIER_SYSTEM_PROMPT,
  VERIFIER_USER_INSTRUCTION,
} from "../prompts";
import {
  extractJson,
  parseImageDataUri,
  type EnsembleResult,
  type ModelTierInfo,
  type PrimaryCall,
  type TokenUsage,
  type VerifierCall,
} from "./types";
import type { VerifierAssessment, VisionAssessment } from "../schemas";
import type { z } from "zod";

/**
 * Open-weight vision models on Fireworks AI (Invariant 2).
 *
 * Primary: kimi-k3p1-pro — multimodal, strict json_schema mode, exposes
 * reasoning_content. Verifier: deepseek-v4p1-flash (fallback qwen3p8-max),
 * an independent model family running the slim vehicle-ID schema so vehicle
 * hallucinations are caught cheaply. Never glm-5p3 — that model is text-only.
 */

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

export const FIREWORKS_PRIMARY_MODEL =
  process.env.FIREWORKS_PRIMARY_MODEL ??
  "accounts/fireworks/models/kimi-k3p1-pro";

/** Independent fast verifier; overridable to qwen3p8-max via env. */
export const FIREWORKS_VERIFIER_MODEL =
  process.env.FIREWORKS_VERIFIER_MODEL ??
  "accounts/fireworks/models/deepseek-v4p1-flash";

const PRIMARY_TIMEOUT_MS = 180_000;
const VERIFIER_TIMEOUT_MS = 90_000;
/**
 * Reasoning tokens count toward max_tokens (plan §3.1). Measured on the full
 * 28-panel schema: kimi-k3p1-pro reasons well past 4000 tokens before the
 * JSON, and the verifier burns its whole budget reasoning too — so both
 * budgets are set generously to avoid finish_reason=length truncation.
 */
const PRIMARY_MAX_TOKENS = 16_000;
const VERIFIER_MAX_TOKENS = 8_000;

export function fireworksConfigured(): boolean {
  return Boolean(process.env.FIREWORKS_API_KEY);
}

export function openWeightTierInfo(): ModelTierInfo {
  return {
    tier: "open-weight",
    label: "Open-Weight (Fireworks)",
    model: FIREWORKS_PRIMARY_MODEL,
    provider: "fireworks",
    available: fireworksConfigured(),
    reason: fireworksConfigured()
      ? "FIREWORKS_API_KEY present"
      : "FIREWORKS_API_KEY not set",
  };
}

interface FireworksChoice {
  message: {
    content: string | null;
    reasoning_content?: string | null;
  };
  finish_reason: string;
}

interface FireworksResponse {
  choices: FireworksChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface FireworksCallOutput {
  content: string;
  reasoning: string | null;
  usage: TokenUsage | null;
  latencyMs: number;
}

async function callFireworks(args: {
  model: string;
  systemPrompt: string;
  userInstruction: string;
  imageDataUri: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<FireworksCallOutput> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not configured");
  }

  const body = {
    model: args.model,
    max_tokens: args.maxTokens,
    temperature: 0,
    messages: [
      { role: "system", content: args.systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: args.imageDataUri } },
          { type: "text", text: args.userInstruction },
        ],
      },
    ],
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: args.schemaName,
        schema: args.schema,
        strict: true,
      },
    },
  };

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(FIREWORKS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `Fireworks request failed (${args.model}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Fireworks ${response.status} from ${args.model}: ${detail.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as FireworksResponse;
  const choice = json.choices?.[0];
  if (!choice || typeof choice.message?.content !== "string") {
    throw new Error(
      `Fireworks returned no content (${args.model}, finish_reason=${choice?.finish_reason ?? "unknown"})`,
    );
  }

  return {
    content: choice.message.content,
    reasoning: choice.message.reasoning_content ?? null,
    usage: json.usage
      ? {
          prompt_tokens: json.usage.prompt_tokens,
          completion_tokens: json.usage.completion_tokens,
          total_tokens: json.usage.total_tokens,
          reasoning_tokens:
            json.usage.completion_tokens_details?.reasoning_tokens ?? null,
        }
      : null,
    latencyMs: Date.now() - startedAt,
  };
}

/** Validate raw model output against a zod schema with a useful error. */
function validate<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  model: string,
): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Schema validation failed for ${model}: ${result.error.message}`,
    );
  }
  return result.data;
}

/** Primary open-weight assessment (kimi-k3p1-pro, strict json_schema). */
export async function fireworksAssessPrimary(
  imageDataUri: string,
): Promise<PrimaryCall> {
  // Fails fast with a clear message if the data URI is malformed.
  parseImageDataUri(imageDataUri);
  const out = await callFireworks({
    model: FIREWORKS_PRIMARY_MODEL,
    systemPrompt: APPRAISER_SYSTEM_PROMPT,
    userInstruction: APPRAISER_USER_INSTRUCTION,
    imageDataUri,
    schema: visionAssessmentJsonSchema(),
    schemaName: "vision_assessment",
    maxTokens: PRIMARY_MAX_TOKENS,
    timeoutMs: PRIMARY_TIMEOUT_MS,
  });
  const data = validate<VisionAssessment>(
    extractJson(out.content),
    VisionAssessmentSchema,
    FIREWORKS_PRIMARY_MODEL,
  );
  return {
    data,
    provider: "fireworks",
    model: FIREWORKS_PRIMARY_MODEL,
    latency_ms: out.latencyMs,
    usage: out.usage,
    reasoning: out.reasoning,
  };
}

/** Slim independent vehicle-ID verification (deepseek-v4p1-flash / qwen3p8-max). */
export async function fireworksVerifyVehicleId(
  imageDataUri: string,
): Promise<VerifierCall> {
  parseImageDataUri(imageDataUri);
  const out = await callFireworks({
    model: FIREWORKS_VERIFIER_MODEL,
    systemPrompt: VERIFIER_SYSTEM_PROMPT,
    userInstruction: VERIFIER_USER_INSTRUCTION,
    imageDataUri,
    schema: verifierAssessmentJsonSchema(),
    schemaName: "verifier_assessment",
    maxTokens: VERIFIER_MAX_TOKENS,
    timeoutMs: VERIFIER_TIMEOUT_MS,
  });
  const data = validate<VerifierAssessment>(
    extractJson(out.content),
    VerifierAssessmentSchema,
    FIREWORKS_VERIFIER_MODEL,
  );
  return {
    data,
    provider: "fireworks",
    model: FIREWORKS_VERIFIER_MODEL,
    latency_ms: out.latencyMs,
    usage: out.usage,
    reasoning: out.reasoning,
  };
}

/**
 * Run primary + verifier concurrently. Promise.allSettled guarantees a
 * verifier failure degrades gracefully (verifierError set, primary intact).
 */
export async function runOpenWeightEnsemble(
  imageDataUri: string,
): Promise<EnsembleResult> {
  const [primaryRes, verifierRes] = await Promise.allSettled([
    fireworksAssessPrimary(imageDataUri),
    fireworksVerifyVehicleId(imageDataUri),
  ]);

  return {
    primary:
      primaryRes.status === "fulfilled" ? primaryRes.value : null,
    primaryError:
      primaryRes.status === "rejected"
        ? primaryRes.reason instanceof Error
          ? primaryRes.reason.message
          : String(primaryRes.reason)
        : null,
    verifier:
      verifierRes.status === "fulfilled" ? verifierRes.value : null,
    verifierError:
      verifierRes.status === "rejected"
        ? verifierRes.reason instanceof Error
          ? verifierRes.reason.message
          : String(verifierRes.reason)
        : null,
  };
}
