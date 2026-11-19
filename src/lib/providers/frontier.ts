import { VisionAssessmentSchema, visionAssessmentJsonSchema } from "../schemas";
import type { VisionAssessment } from "../schemas";
import {
  APPRAISER_SYSTEM_PROMPT,
  APPRAISER_USER_INSTRUCTION,
} from "../prompts";
import {
  extractJson,
  parseImageDataUri,
  type ModelTierInfo,
  type PrimaryCall,
  type TokenUsage,
} from "./types";

/**
 * Optional frontier-model adapter (Invariant 2): Anthropic, OpenAI, and
 * Gemini entries appear in the Model Strategy selector only when their env
 * keys are present, enabling live open-weight vs. frontier comparison.
 */

const TIMEOUT_MS = 120_000;
// Headroom for adaptive thinking + full JSON payload — truncation mid-schema
// fails zod validation downstream, so the cap stays generous.
const MAX_TOKENS = 8192;

const FRONTIER_MODELS: Record<
  Exclude<import("./types").ModelTier, "open-weight">,
  { model: string; label: string; envKey: string }
> = {
  anthropic: {
    model: process.env.ANTHROPIC_VISION_MODEL ?? "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    envKey: "ANTHROPIC_API_KEY",
  },
  openai: {
    model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
    label: "OpenAI (Frontier)",
    envKey: "OPENAI_API_KEY",
  },
  gemini: {
    model: process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash",
    label: "Google Gemini (Frontier)",
    envKey: "GEMINI_API_KEY",
  },
};

export type FrontierTier = keyof typeof FRONTIER_MODELS;

export function isFrontierTier(tier: string): tier is FrontierTier {
  return tier in FRONTIER_MODELS;
}

/** Availability metadata for the UI dropdown — never leaks key values. */
export function listFrontierTiers(): ModelTierInfo[] {
  return Object.entries(FRONTIER_MODELS).map(([tier, cfg]) => ({
    tier: tier as FrontierTier,
    label: cfg.label,
    model: cfg.model,
    provider: tier,
    available: Boolean(process.env[cfg.envKey]),
    reason: process.env[cfg.envKey]
      ? `${cfg.envKey} present`
      : `${cfg.envKey} not set`,
  }));
}

interface RawCallOutput {
  content: string;
  usage: TokenUsage | null;
  latencyMs: number;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `Frontier request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Frontier ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

async function callAnthropic(
  imageDataUri: string,
  model: string,
): Promise<RawCallOutput> {
  const { mediaType, base64 } = parseImageDataUri(imageDataUri);
  const startedAt = Date.now();
  const json = (await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    {
      model,
      max_tokens: MAX_TOKENS,
      // No temperature: deprecated on claude-sonnet-5-5 (model-managed setting).
      system: APPRAISER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: APPRAISER_USER_INSTRUCTION },
          ],
        },
      ],
    },
  )) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = (json.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return {
    content: text,
    usage: json.usage
      ? {
          prompt_tokens: json.usage.input_tokens,
          completion_tokens: json.usage.output_tokens,
        }
      : null,
    latencyMs: Date.now() - startedAt,
  };
}

async function callOpenai(
  imageDataUri: string,
  model: string,
): Promise<RawCallOutput> {
  const startedAt = Date.now();
  const json = (await postJson(
    "https://api.openai.com/v1/chat/completions",
    {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      "Content-Type": "application/json",
    },
    {
      model,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: APPRAISER_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUri } },
            { type: "text", text: APPRAISER_USER_INSTRUCTION },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "vision_assessment",
          schema: visionAssessmentJsonSchema(),
          strict: true,
        },
      },
    },
  )) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    content: json.choices?.[0]?.message?.content ?? "",
    usage: json.usage ?? null,
    latencyMs: Date.now() - startedAt,
  };
}

async function callGemini(
  imageDataUri: string,
  model: string,
): Promise<RawCallOutput> {
  const { mediaType, base64 } = parseImageDataUri(imageDataUri);
  const startedAt = Date.now();
  const json = (await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      "Content-Type": "application/json",
    },
    {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: `${APPRAISER_SYSTEM_PROMPT}\n\n${APPRAISER_USER_INSTRUCTION}` },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: MAX_TOKENS,
        temperature: 0,
      },
    },
  )) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
    };
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
  return {
    content: text,
    usage: json.usageMetadata
      ? {
          prompt_tokens: json.usageMetadata.promptTokenCount,
          completion_tokens: json.usageMetadata.candidatesTokenCount,
        }
      : null,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Run the primary assessment on a frontier model. Structured output is
 * enforced via json_schema where supported (OpenAI) and always re-validated
 * with zod, so downstream code never sees unvalidated model output.
 */
export async function frontierAssess(
  tier: FrontierTier,
  imageDataUri: string,
): Promise<PrimaryCall> {
  const cfg = FRONTIER_MODELS[tier];
  if (!process.env[cfg.envKey]) {
    throw new Error(`${cfg.envKey} is not configured`);
  }

  const out =
    tier === "anthropic"
      ? await callAnthropic(imageDataUri, cfg.model)
      : tier === "openai"
        ? await callOpenai(imageDataUri, cfg.model)
        : await callGemini(imageDataUri, cfg.model);

  const parsed = VisionAssessmentSchema.safeParse(extractJson(out.content));
  if (!parsed.success) {
    throw new Error(
      `Schema validation failed for ${cfg.model}: ${parsed.error.message}`,
    );
  }
  const data: VisionAssessment = parsed.data;

  return {
    data,
    provider: tier,
    model: cfg.model,
    latency_ms: out.latencyMs,
    usage: out.usage,
    reasoning: null,
  };
}
