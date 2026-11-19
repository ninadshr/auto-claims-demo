/** Presentation-only formatting helpers (client-safe, zero logic). */

export function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** `front_left_fender` → `front left fender`. */
export function humanize(s: string): string {
  return s.replaceAll("_", " ");
}

export function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function compactTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
