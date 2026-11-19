"use client";

import { Scale } from "lucide-react";
import type { CostEstimate } from "@/lib/costing";
import { usd } from "@/lib/format";

/** Itemized deterministic rate-card estimate + uncertainty range (plan §7). */
export default function CostBreakdownTable({ estimate }: { estimate: CostEstimate }) {
  const t = estimate.totals;
  const fees: [string, number][] = [
    ["Pre/post repair ADAS scan", t.pre_post_scan_usd],
    ["Shop supplies", t.shop_supplies_usd],
    ["Hazmat / waste disposal", t.hazmat_usd],
    ["Sales tax (parts + materials)", t.tax_usd],
  ];

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Deterministic cost estimate
        </h3>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800">
          rate card {estimate.rate_card_version} · {estimate.region}
        </span>
      </div>

      {estimate.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
          {estimate.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-3 font-medium">Line item</th>
              <th className="py-2 pr-3 text-right font-medium">Parts</th>
              <th className="py-2 pr-3 text-right font-medium">Body hrs</th>
              <th className="py-2 pr-3 text-right font-medium">Paint hrs</th>
              <th className="py-2 pr-3 text-right font-medium">Mech hrs</th>
              <th className="py-2 pr-3 text-right font-medium">Materials</th>
              <th className="py-2 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {estimate.line_items.map((line) => (
              <tr
                key={`${line.panel}-${line.operation}`}
                className={line.operation === "BLEND" ? "text-zinc-500" : ""}
              >
                <td className="py-2 pr-3">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {line.description}
                  </span>
                  {line.operation === "BLEND" && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      auto-injected
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {line.parts_usd > 0 ? usd(line.parts_usd) : "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {line.body_hrs > 0 ? line.body_hrs.toFixed(1) : "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {line.paint_hrs > 0 ? line.paint_hrs.toFixed(1) : "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {line.mechanical_hrs > 0 ? line.mechanical_hrs.toFixed(1) : "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {line.materials_usd > 0 ? usd(line.materials_usd) : "—"}
                </td>
                <td className="py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                  {usd(line.line_total_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Totals --- */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Parts</dt>
              <dd className="tabular-nums">{usd(t.parts_usd)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Labor (body / paint / mech)</dt>
              <dd className="tabular-nums">{usd(t.labor_usd)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Paint materials</dt>
              <dd className="tabular-nums">{usd(t.materials_usd)}</dd>
            </div>
            {fees
              .filter(([, amount]) => amount > 0)
              .map(([label, amount]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-zinc-500">{label}</dt>
                  <dd className="tabular-nums">{usd(amount)}</dd>
                </div>
              ))}
            <div className="mt-2 flex justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <dt className="font-semibold text-zinc-900 dark:text-zinc-100">
                Point estimate
              </dt>
              <dd className="text-base font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {usd(t.point_usd)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Low
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                {usd(estimate.uncertainty.low_usd)}
              </div>
            </div>
            <div className="rounded-md bg-zinc-100 py-1 dark:bg-zinc-800">
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Point
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {usd(estimate.uncertainty.point_usd)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                High
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                {usd(estimate.uncertainty.high_usd)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            ±{Math.round(estimate.uncertainty.band * 100)}% band — drivers:
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {estimate.uncertainty.reasons.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        </div>
      </div>

      {estimate.notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-zinc-500">
          {estimate.notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      )}

      <p className="mt-4 flex items-start gap-1.5 border-t border-zinc-200 pt-3 text-xs italic text-zinc-500 dark:border-zinc-800">
        <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {estimate.disclaimer}
      </p>
    </section>
  );
}
