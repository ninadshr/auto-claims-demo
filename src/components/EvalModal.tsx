"use client";

import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FlaskConical,
  Loader2,
  Play,
  X,
  XCircle,
} from "lucide-react";
import {
  SWEEP_THRESHOLDS,
  baselineMetrics,
  isFullyCorrect,
  routeAtThreshold,
  sweepThresholds,
  type ThresholdPoint,
} from "@/eval/metrics";
import type { EvalResponse, LiveEvalResponse } from "@/eval/api-types";
import type { AnalyzeOptions } from "./UploadPanel";
import { pct, seconds, usd } from "@/lib/format";

/**
 * Evaluation & STP Threshold Simulator: golden-set metrics, the interactive
 * STP-rate-vs-error curve across AUTO_APPROVE floors (0.50–0.95), per-sample
 * routing, and on-demand live evaluation. Threshold math reuses the SAME
 * ordered routing rules as the production pipeline (decideRoute).
 */

interface EvalModalProps {
  open: boolean;
  onClose: () => void;
  data: EvalResponse | null;
  options: AnalyzeOptions;
}

const ROUTE_CHIP: Record<string, string> = {
  AUTO_APPROVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  ESCALATE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  REJECT: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

// Validated 2-series categorical palette (adjacent-pair CVD ΔE 24.7 light /
// 26.8 dark on this surface — see dataviz palette validation).
const SERIES = {
  stp: { light: "#2a78d6", dark: "#3987e5" },
  error: { light: "#eb6834", dark: "#d95926" },
};

const W = 640;
const H = 260;
const M = { top: 16, right: 20, bottom: 34, left: 44 };
const innerW = W - M.left - M.right;
const innerH = H - M.top - M.bottom;
const xOf = (t: number): number => M.left + ((t - 0.5) / 0.45) * innerW;
const yOf = (v: number): number => M.top + (1 - v) * innerH;

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[11px] font-medium leading-tight text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}

export default function EvalModal({ open, onClose, data, options }: EvalModalProps) {
  const [threshold, setThreshold] = useState<number>(
    data?.default_threshold ?? 0.72,
  );
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [live, setLive] = useState<LiveEvalResponse | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const rows = useMemo(
    () => live?.golden_set ?? data?.golden_set ?? [],
    [live, data],
  );
  const sweep = useMemo<ThresholdPoint[]>(
    () => (rows.length > 0 ? sweepThresholds(rows) : []),
    [rows],
  );
  const atSlider = useMemo(
    () => (rows.length > 0 ? baselineMetrics(rows, threshold) : null),
    [rows, threshold],
  );
  const countsAtSlider = useMemo(() => {
    let auto = 0;
    let wrong = 0;
    for (const row of rows) {
      if (routeAtThreshold(row, threshold) === "AUTO_APPROVE") {
        auto += 1;
        if (!isFullyCorrect(row)) wrong += 1;
      }
    }
    return { auto, wrong };
  }, [rows, threshold]);

  const runLive = async () => {
    setLiveBusy(true);
    setLiveError(null);
    try {
      const res = await fetch("/api/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelTier: options.modelTier,
          region: options.region,
        }),
      });
      const json = (await res.json()) as LiveEvalResponse & { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setLive(json);
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setLiveBusy(false);
    }
  };

  if (!open) return null;

  const hover = hoverIdx !== null ? sweep[hoverIdx] : null;
  const hoverX = hover ? xOf(hover.threshold) : 0;

  const onHoverMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || sweep.length === 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const t = 0.5 + ((svgX - M.left) / innerW) * 0.45;
    let best = 0;
    let bestDist = Infinity;
    sweep.forEach((p, i) => {
      const d = Math.abs(p.threshold - t);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHoverIdx(best);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close evaluation modal"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-950/50"
      />
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              <FlaskConical className="h-4.5 w-4.5 text-emerald-600" />
              Evaluation &amp; STP Threshold Simulator
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Golden set: {rows.length} claims (4 live samples + 2 simulated edge
              cases){live ? ` · live run ${new Date(live.ran_at).toLocaleTimeString()}` : " · recorded baseline"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {rows.length === 0 || !atSlider ? (
            <p className="text-sm text-zinc-500">Loading golden set…</p>
          ) : (
            <div className="flex flex-col gap-6">
              {/* --- Metric tiles --- */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Tile label="Panel F1 (micro)" value={atSlider.panel_f1.f1.toFixed(2)} />
                <Tile
                  label="Severity ±1 tier"
                  value={
                    atSlider.severity_ordinal_accuracy === null
                      ? "n/a"
                      : pct(atSlider.severity_ordinal_accuracy)
                  }
                />
                <Tile
                  label="Colour-family accuracy"
                  value={
                    atSlider.colour_family_accuracy === null
                      ? "n/a"
                      : pct(atSlider.colour_family_accuracy)
                  }
                />
                <Tile
                  label="Make accuracy"
                  value={
                    atSlider.make_accuracy === null ? "n/a" : pct(atSlider.make_accuracy)
                  }
                />
                <Tile label="Safe-pass rate" value={pct(atSlider.safe_pass_rate)} />
                <Tile
                  label="Confident & wrong"
                  value={pct(atSlider.confident_and_wrong_rate)}
                />
              </div>

              {/* --- Threshold slider + curve --- */}
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      STP rate vs. error rate
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Re-routes the golden set through the production routing
                      rules at each AUTO_APPROVE confidence floor.
                    </p>
                  </div>
                  {/* Legend (2 series → always present) */}
                  <div className="flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-0.5 w-5 rounded"
                        style={{ backgroundColor: SERIES.stp.light }}
                      />
                      STP rate
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-0.5 w-5 rounded"
                        style={{ backgroundColor: SERIES.error.light }}
                      />
                      Error rate (auto-approved &amp; wrong)
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs tabular-nums text-zinc-500">0.50</span>
                  <input
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.01}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    list="stp-ticks"
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-emerald-600 dark:bg-zinc-700"
                  />
                  <span className="text-xs tabular-nums text-zinc-500">0.95</span>
                  <span className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-bold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
                    floor {threshold.toFixed(2)}
                    {threshold === (data?.default_threshold ?? 0.72) ? " (default)" : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">
                  At floor {threshold.toFixed(2)}:{" "}
                  <strong className="text-zinc-700 dark:text-zinc-300">
                    {countsAtSlider.auto}/{rows.length} claims straight-through
                  </strong>{" "}
                  ({pct(atSlider.stp_rate)}), {countsAtSlider.wrong}{" "}
                  auto-approved &amp; wrong (
                  {pct(atSlider.confident_and_wrong_rate)}).
                </p>

                {/* Chart */}
                <div className="relative mt-3">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full"
                    role="img"
                    aria-label="Line chart of straight-through processing rate and error rate versus AUTO_APPROVE confidence threshold"
                  >
                    {/* Gridlines + y labels */}
                    {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                      <g key={v}>
                        <line
                          x1={M.left}
                          x2={W - M.right}
                          y1={yOf(v)}
                          y2={yOf(v)}
                          className="stroke-zinc-200 dark:stroke-zinc-700"
                          strokeWidth="1"
                        />
                        <text
                          x={M.left - 8}
                          y={yOf(v) + 4}
                          textAnchor="end"
                          className="fill-zinc-400 text-[10px]"
                        >
                          {Math.round(v * 100)}%
                        </text>
                      </g>
                    ))}
                    {/* Baseline */}
                    <line
                      x1={M.left}
                      x2={W - M.right}
                      y1={yOf(0)}
                      y2={yOf(0)}
                      className="stroke-zinc-300 dark:stroke-zinc-600"
                      strokeWidth="1"
                    />
                    {/* X ticks (0.50–0.95) */}
                    {SWEEP_THRESHOLDS.map((t) => (
                      <text
                        key={t}
                        x={xOf(t)}
                        y={H - 12}
                        textAnchor="middle"
                        className="fill-zinc-400 text-[10px]"
                      >
                        {t.toFixed(2)}
                      </text>
                    ))}
                    {/* Series */}
                    {(["stp_rate", "error_rate"] as const).map((key) => (
                      <polyline
                        key={key}
                        points={sweep.map((p) => `${xOf(p.threshold)},${yOf(p[key])}`).join(" ")}
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={
                          key === "stp_rate"
                            ? "stroke-[#2a78d6] dark:stroke-[#3987e5]"
                            : "stroke-[#eb6834] dark:stroke-[#d95926]"
                        }
                      />
                    ))}
                    {/* Markers (2px surface ring) */}
                    {sweep.map((p) => (
                      <g key={p.threshold}>
                        <circle
                          cx={xOf(p.threshold)}
                          cy={yOf(p.stp_rate)}
                          r="4"
                          className="fill-[#2a78d6] dark:fill-[#3987e5] stroke-white dark:stroke-zinc-900"
                          strokeWidth="2"
                        />
                        <circle
                          cx={xOf(p.threshold)}
                          cy={yOf(p.error_rate)}
                          r="4"
                          className="fill-[#eb6834] dark:fill-[#d95926] stroke-white dark:stroke-zinc-900"
                          strokeWidth="2"
                        />
                      </g>
                    ))}
                    {/* Slider threshold marker */}
                    <line
                      x1={xOf(threshold)}
                      x2={xOf(threshold)}
                      y1={M.top}
                      y2={M.top + innerH}
                      className="stroke-zinc-400 dark:stroke-zinc-500"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={xOf(threshold)}
                      cy={yOf(atSlider.stp_rate)}
                      r="5"
                      className="fill-[#2a78d6] dark:fill-[#3987e5] stroke-white dark:stroke-zinc-900"
                      strokeWidth="2"
                    />
                    <circle
                      cx={xOf(threshold)}
                      cy={yOf(atSlider.confident_and_wrong_rate)}
                      r="5"
                      className="fill-[#eb6834] dark:fill-[#d95926] stroke-white dark:stroke-zinc-900"
                      strokeWidth="2"
                    />
                    {/* Selective direct labels at the slider point */}
                    <text
                      x={xOf(threshold) + (threshold > 0.8 ? -10 : 10)}
                      y={yOf(atSlider.stp_rate) - 8}
                      textAnchor={threshold > 0.8 ? "end" : "start"}
                      className="fill-zinc-600 dark:fill-zinc-300 text-[11px] font-semibold"
                    >
                      {pct(atSlider.stp_rate)} STP
                    </text>
                    <text
                      x={xOf(threshold) + (threshold > 0.8 ? -10 : 10)}
                      y={yOf(atSlider.confident_and_wrong_rate) + 16}
                      textAnchor={threshold > 0.8 ? "end" : "start"}
                      className="fill-zinc-600 dark:fill-zinc-300 text-[11px] font-semibold"
                    >
                      {pct(atSlider.confident_and_wrong_rate)} wrong
                    </text>
                    {/* Crosshair + hit target */}
                    {hover && (
                      <line
                        x1={hoverX}
                        x2={hoverX}
                        y1={M.top}
                        y2={M.top + innerH}
                        className="stroke-zinc-300 dark:stroke-zinc-600"
                        strokeWidth="1"
                      />
                    )}
                    <rect
                      x={M.left}
                      y={M.top}
                      width={innerW}
                      height={innerH}
                      fill="transparent"
                      onMouseMove={onHoverMove}
                      onMouseLeave={() => setHoverIdx(null)}
                    />
                  </svg>

                  {/* Tooltip (values also in the sweep table below) */}
                  {hover && (
                    <div
                      className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-zinc-200 bg-white p-2.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
                      style={{
                        left: `${(hoverX / W) * 100}%`,
                        transform: hoverX > W * 0.6 ? "translateX(-110%)" : "translateX(10%)",
                      }}
                    >
                      <div className="text-xs font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                        Floor {hover.threshold.toFixed(2)}
                      </div>
                      <div className="mt-1 space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-zinc-500">
                            <span
                              className="inline-block h-0.5 w-4 rounded"
                              style={{ backgroundColor: SERIES.stp.light }}
                            />
                            STP
                          </span>
                          <strong className="tabular-nums text-zinc-900 dark:text-zinc-100">
                            {pct(hover.stp_rate)}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-zinc-500">
                            <span
                              className="inline-block h-0.5 w-4 rounded"
                              style={{ backgroundColor: SERIES.error.light }}
                            />
                            Wrong
                          </span>
                          <strong className="tabular-nums text-zinc-900 dark:text-zinc-100">
                            {pct(hover.error_rate)}
                          </strong>
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {hover.auto_approved}/{rows.length} auto ·{" "}
                          {hover.confident_and_wrong} wrong
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Table view (a11y — every chart value is reachable without hover) */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                    View sweep data table
                  </summary>
                  <table className="mt-2 w-full max-w-md text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                        <th className="py-1.5 pr-3 font-medium">Floor</th>
                        <th className="py-1.5 pr-3 text-right font-medium">STP</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Wrong</th>
                        <th className="py-1.5 text-right font-medium">Auto / total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {sweep.map((p) => (
                        <tr
                          key={p.threshold}
                          className={
                            p.threshold === threshold
                              ? "font-semibold text-zinc-900 dark:text-zinc-100"
                              : ""
                          }
                        >
                          <td className="py-1.5 pr-3 tabular-nums">{p.threshold.toFixed(2)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{pct(p.stp_rate)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{pct(p.error_rate)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {p.auto_approved}/{rows.length}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>

              {/* --- Sample routing at the current floor --- */}
              <section>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Sample routing at floor {threshold.toFixed(2)}
                </h3>
                <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {rows.map((row) => {
                    const route = routeAtThreshold(row, threshold);
                    const matches = route === row.expected_route;
                    return (
                      <li key={row.id} className="flex items-center gap-2 py-2 text-sm">
                        {matches ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-amber-500" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                          {row.label}
                        </span>
                        {row.simulated ? (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                            simulated
                          </span>
                        ) : (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                            live sample
                          </span>
                        )}
                        <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                          expect
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ROUTE_CHIP[row.expected_route]}`}
                        >
                          {row.expected_route}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                          →
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ROUTE_CHIP[route]}`}
                        >
                          {route}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* --- Live evaluation --- */}
              <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Live evaluation
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Re-runs the 4 sample images through the full ensemble (
                      {options.modelTier === "open-weight"
                        ? "Kimi K3.1 Pro + DeepSeek V4.1 verifier"
                        : options.modelTier}
                      , {options.region}) and re-scores against ground truth —
                      about 2 minutes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={runLive}
                    disabled={liveBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {liveBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {liveBusy ? "Running…" : "Run live evaluation"}
                  </button>
                </div>

                {liveError && (
                  <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                    {liveError}
                  </p>
                )}

                {live && (
                  <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {live.per_sample.map((sample) => (
                      <li
                        key={sample.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
                      >
                        <span className="min-w-0 truncate font-mono text-zinc-600 dark:text-zinc-400">
                          {sample.id}
                        </span>
                        {sample.ok ? (
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="tabular-nums text-zinc-500">
                              {seconds(sample.latency_ms ?? 0)}
                              {sample.cost_usd !== null && ` · ${usd(sample.cost_usd)}`}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ROUTE_CHIP[sample.route] ?? ""}`}
                            >
                              {sample.route}
                            </span>
                          </span>
                        ) : (
                          <span className="truncate text-rose-600 dark:text-rose-400">
                            failed — baseline kept
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
