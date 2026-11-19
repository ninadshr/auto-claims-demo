import type { TokenUsage } from "./types";

/**
 * ILLUSTRATIVE per-million-token inference prices for the UI's cost-per-claim
 * telemetry. These are NOT repair-cost math — every repair dollar lives in
 * `costing.ts` (Invariant 1). Swap for your carrier's actual provider rates.
 *
 * Keys must stay in sync with the default model ids in
 * `providers/fireworks.ts` / `providers/frontier.ts`.
 */

const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "accounts/fireworks/models/kimi-k3p1-pro": { input: 1.0, output: 3.0 },
  "accounts/fireworks/models/deepseek-v4p1-flash": { input: 0.15, output: 0.6 },
  "accounts/fireworks/models/qwen3p8-max": { input: 0.2, output: 0.6 },
  "claude-sonnet-5-5": { input: 3.0, output: 15.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

/** Conservative fallback for env-overridden model ids. */
const DEFAULT_PRICE = { input: 1.0, output: 3.0 };

/**
 * Sum the illustrative inference cost across the ensemble's model calls.
 * Returns null when no call reported token usage.
 */
export function estimateInferenceCostUsd(
  calls: { model: string; usage: TokenUsage | null }[],
): number | null {
  let total: number | null = null;
  for (const call of calls) {
    if (!call.usage) continue;
    const price = PRICES_USD_PER_MTOK[call.model] ?? DEFAULT_PRICE;
    const cost =
      (call.usage.prompt_tokens / 1_000_000) * price.input +
      (call.usage.completion_tokens / 1_000_000) * price.output;
    total = (total ?? 0) + cost;
  }
  return total === null ? null : Math.round(total * 100000) / 100000;
}
