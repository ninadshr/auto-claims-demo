"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  CheckCircle2,
  Clock,
  Coins,
  Gauge,
  Info,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/analysis";
import { estimateInferenceCostUsd } from "@/lib/providers/pricing";
import { compactTokens, humanize, seconds, usd } from "@/lib/format";

interface ResultsDashboardProps {
  result: AnalysisResult;
  onOpenFlywheel: () => void;
}

const ROUTE_STYLE = {
  AUTO_APPROVE: {
    banner: "bg-emerald-600 text-white",
    icon: CheckCircle2,
    label: "AUTO-APPROVE — straight-through processing",
  },
  ESCALATE: {
    banner: "bg-amber-400 text-amber-950",
    icon: AlertTriangle,
    label: "ESCALATE — human review required",
  },
  REJECT: {
    banner: "bg-rose-600 text-white",
    icon: XCircle,
    label: "REJECT — no collision damage to assess",
  },
} as const;

/** Confidence meter: fill carries severity, track is a lighter step of the same ramp. */
function Meter({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 0.72
      ? "bg-emerald-500"
      : value >= 0.6
        ? "bg-amber-500"
        : "bg-rose-500";
  const track =
    value >= 0.72
      ? "bg-emerald-100 dark:bg-emerald-500/20"
      : value >= 0.6
        ? "bg-amber-100 dark:bg-amber-500/20"
        : "bg-rose-100 dark:bg-rose-500/20";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
          {value.toFixed(2)}
        </span>
      </div>
      <div className={`mt-1 h-1.5 w-full overflow-hidden rounded-full ${track}`}>
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string | null;
  confidence?: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      {value === null ? (
        <div className="mt-0.5 text-sm font-medium italic text-zinc-400">
          Abstained — below confidence floor
        </div>
      ) : (
        <div className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {value}
        </div>
      )}
      {confidence !== undefined && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-500 dark:bg-zinc-400"
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-zinc-500">
            conf {confidence.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}

const SEVERITY_CHIP: Record<string, string> = {
  cosmetic: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  minor: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  severe: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  destroyed: "bg-rose-600 text-white",
};

const BADGE_STYLE =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";

export default function ResultsDashboard({
  result,
  onOpenFlywheel,
}: ResultsDashboardProps) {
  const { assessment, confidence, estimate, verifier } = result;
  const route = ROUTE_STYLE[result.route];
  const RouteIcon = route.icon;

  const costUsd = estimateInferenceCostUsd([
    { model: result.primary.model, usage: result.primary.usage },
    ...(verifier ? [{ model: verifier.model, usage: verifier.usage }] : []),
  ]);
  const totalTokens =
    (result.primary.usage?.total_tokens ??
      (result.primary.usage
        ? result.primary.usage.prompt_tokens + result.primary.usage.completion_tokens
        : 0)) +
    (verifier?.usage?.total_tokens ??
      (verifier?.usage
        ? verifier.usage.prompt_tokens + verifier.usage.completion_tokens
        : 0));

  const hasDisagreement = confidence.disagreements.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* --- Routing banner --- */}
      <section
        className={`flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between ${route.banner}`}
      >
        <div className="flex items-start gap-3">
          <RouteIcon className="mt-0.5 h-7 w-7 shrink-0" />
          <div>
            <h2 className="text-lg font-bold tracking-tight">{route.label}</h2>
            <ul className="mt-1 space-y-0.5 text-sm font-medium opacity-90">
              {result.routing_reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-1 text-xs font-semibold">
            <Clock className="h-3.5 w-3.5" />
            {seconds(result.primary.latency_ms)} primary
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-1 text-xs font-semibold tabular-nums">
            <Brain className="h-3.5 w-3.5" />
            {compactTokens(totalTokens)} tokens
          </span>
          {costUsd !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-1 text-xs font-semibold tabular-nums">
              <Coins className="h-3.5 w-3.5" />
              ≈ {usd(costUsd)} per claim
              <span className="font-normal opacity-75">illustrative</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-1 text-xs font-semibold">
            <BadgeCheck className="h-3.5 w-3.5" />
            verifier {result.verifier_status}
          </span>
        </div>
      </section>

      {/* --- Composite confidence --- */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Gauge className="h-4 w-4 text-zinc-400" />
            Composite confidence
          </h3>
          <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
            Overall {confidence.overall.toFixed(2)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Meter label="Vehicle ID" value={confidence.vehicle_id_score} />
          <Meter label="Damage detection" value={confidence.damage_score} />
          <Meter label="Cost" value={confidence.cost_score} />
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-zinc-500">
                Cross-model agreement
              </span>
              <span className="text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                {confidence.agreement !== null ? confidence.agreement.toFixed(2) : "n/a"}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full ${
                  confidence.agreement === null
                    ? "bg-zinc-300 dark:bg-zinc-600"
                    : confidence.agreement >= 0.6
                      ? "bg-emerald-500"
                      : "bg-rose-500"
                }`}
                style={{
                  width: `${confidence.agreement !== null ? confidence.agreement * 100 : 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* --- Vehicle metadata + verifier --- */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <ShieldCheck className="h-4 w-4 text-zinc-400" />
          Vehicle metadata
          <span className="font-normal text-zinc-400">
            primary · {result.primary.model.split("/").pop()}
          </span>
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Make" value={assessment.vehicle.make} confidence={assessment.vehicle.make_confidence} />
          <Field label="Model" value={assessment.vehicle.model} confidence={assessment.vehicle.model_confidence} />
          <Field label="Colour" value={assessment.vehicle.colour} confidence={assessment.vehicle.colour_confidence} />
          <Field label="Vehicle class" value={humanize(assessment.vehicle.vehicle_class)} confidence={assessment.vehicle.class_confidence} />
        </div>

        {verifier && (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Independent cross-model verifier · {verifier.model.split("/").pop()}
              </h4>
              <span className="text-xs text-zinc-500">
                reads: {verifier.assessment.make ?? "—"}{" "}
                {verifier.assessment.model ?? "—"}
                {verifier.assessment.colour ? `, ${verifier.assessment.colour}` : ""}
              </span>
            </div>
            {hasDisagreement ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  Cross-model disagreement — held for human review
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300/90">
                  {confidence.disagreements.map((d) => (
                    <li key={d} className="font-mono">
                      {d}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300/70">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Parts pricing keys off vehicle_class ({humanize(assessment.vehicle.vehicle_class)}),
                  not the exact model string — so a wrong badge guess can never
                  poison the repair estimate.
                </p>
              </div>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Verifier agrees on vehicle identity (agreement {confidence.agreement?.toFixed(2)}).
              </p>
            )}
          </div>
        )}
      </section>

      {/* --- Damage summary --- */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Damage summary
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {assessment.damage_summary}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {assessment.has_airbag_deployment && (
            <span className={`${BADGE_STYLE} bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Airbag deployed
            </span>
          )}
          {assessment.has_structural_indicators && (
            <span className={`${BADGE_STYLE} bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Structural indicators
            </span>
          )}
          {estimate.is_total_loss_likely && (
            <span className={`${BADGE_STYLE} bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Total loss likely
            </span>
          )}
          {assessment.has_preexisting_wear_only && (
            <span className={`${BADGE_STYLE} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
              Pre-existing wear only
            </span>
          )}
          {!assessment.is_single_vehicle && (
            <span className={`${BADGE_STYLE} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
              Multi-vehicle scene
            </span>
          )}
          <span className={`${BADGE_STYLE} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
            Image quality: {assessment.image_quality}
          </span>
          <span className={`${BADGE_STYLE} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
            Hidden-damage risk: {assessment.hidden_damage_risk}
          </span>
          {estimate.is_total_loss_likely && (
            <span className={`${BADGE_STYLE} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
              {estimate.total_loss_reasons.join(" ")}
            </span>
          )}
        </div>

        {assessment.damage_items.length > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {assessment.damage_items.map((item) => (
              <div
                key={`${item.panel}-${item.damage_type}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {humanize(item.panel)}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{item.notes}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_CHIP[item.severity]}`}
                  >
                    {item.severity}
                  </span>
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                    {item.recommended_operation}
                  </span>
                  <span className="text-[10px] tabular-nums text-zinc-500">
                    {item.affected_area_pct}% · conf {item.confidence.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm italic text-zinc-500">
            No collision damage items detected.
          </p>
        )}
      </section>

      {/* --- Flywheel teaser --- */}
      {result.scale.escalation && (
        <button
          type="button"
          onClick={onOpenFlywheel}
          className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-5 py-3.5 text-left transition hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:hover:bg-amber-500/20"
        >
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Scale API escalation task generated ({result.scale.escalation.status}) —
            open the Flywheel Inspector
          </span>
          <span className="text-xs font-mono text-amber-700 dark:text-amber-400">
            {result.scale.escalation.task_id.slice(0, 18)}…
          </span>
        </button>
      )}
    </div>
  );
}
