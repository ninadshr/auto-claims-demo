"use client";

import { useState } from "react";
import { Brain, FileJson, Tags, X } from "lucide-react";
import type { AnalysisResult } from "@/lib/analysis";

/**
 * Scale AI Flywheel & Reasoning Inspector (plan §8.2): the generated
 * human-labeling escalation JSON, Nucleus failure-slice tags, and the primary
 * model's reasoning trace — everything the flywheel would ship to Scale.
 */

type Tab = "escalation" | "slices" | "reasoning";

interface FlywheelDrawerProps {
  open: boolean;
  result: AnalysisResult | null;
  onClose: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  SIMULATED_LOCAL: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  SUBMITTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  SUBMIT_FAILED: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export default function FlywheelDrawer({ open, result, onClose }: FlywheelDrawerProps) {
  const [tab, setTab] = useState<Tab>("escalation");
  if (!open || !result) return null;

  const { scale, primary, verifier } = result;
  const escalation = scale.escalation;
  const sliceTags = scale.slice_tags.filter((t) => t.startsWith("slice:"));
  const metaTags = scale.slice_tags.filter((t) => !t.startsWith("slice:"));

  const tabs: { key: Tab; label: string; icon: typeof FileJson }[] = [
    { key: "escalation", label: "Escalation task", icon: FileJson },
    { key: "slices", label: "Nucleus slices", icon: Tags },
    { key: "reasoning", label: "Model reasoning", icon: Brain },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close flywheel drawer"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-950/40"
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Scale AI Flywheel &amp; Reasoning Inspector
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-zinc-200 px-4 pt-3 dark:border-zinc-800">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition ${
                tab === key
                  ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "escalation" &&
            (escalation ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[escalation.status]}`}
                  >
                    {escalation.status === "SIMULATED_LOCAL"
                      ? "Simulated — SCALE_API_KEY not set, persisted to .local_store/escalations.jsonl"
                      : escalation.status}
                  </span>
                  <code className="text-xs text-zinc-500">{escalation.task_id}</code>
                </div>
                <p className="text-xs leading-relaxed text-zinc-500">
                  Structured human-labeling task: Panel × Severity × Operation
                  ontology, VLM prelabels as hypotheses, verifier disagreement
                  flags, and estimate summary — ready to POST to Scale Rapid /
                  Studio the moment a key is configured.
                </p>
                <pre className="max-h-[55vh] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-emerald-100">
                  {JSON.stringify(escalation.payload, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                No escalation task was generated — this claim did not route to
                ESCALATE. The flywheel only spends human-labeling budget on
                claims that need it.
              </p>
            ))}

          {tab === "slices" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Failure-slice tags (Scale Nucleus regression candidates)
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sliceTags.length > 0 ? (
                    sliceTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-amber-100 px-2.5 py-1 font-mono text-[11px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs italic text-zinc-500">
                      No failure-slice flags on this assessment.
                    </span>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Stratification metadata
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {metaTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Dataset curation
                </h3>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Dataset</dt>
                    <dd className="font-mono text-xs">{scale.curation.dataset}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Suggested action</dt>
                    <dd className="font-medium">{scale.curation.suggested_action.replaceAll("_", " ")}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Review priority</dt>
                    <dd className="font-medium">{scale.curation.review_priority}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {tab === "reasoning" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Primary · {primary.model}
                </h3>
                <p className="mt-1.5 text-xs text-zinc-500">
                  latency {primary.latency_ms} ms ·{" "}
                  {primary.usage
                    ? `${primary.usage.prompt_tokens} in / ${primary.usage.completion_tokens} out${
                        primary.usage.reasoning_tokens
                          ? ` (${primary.usage.reasoning_tokens} reasoning)`
                          : ""
                      }`
                    : "no usage reported"}
                </p>
                {primary.reasoning ? (
                  <details className="mt-3" open>
                    <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      Collapsible reasoning trace (reasoning_content)
                    </summary>
                    <pre className="mt-2 max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                      {primary.reasoning}
                    </pre>
                  </details>
                ) : (
                  <p className="mt-2 text-xs italic text-zinc-500">
                    This provider did not return a reasoning trace.
                  </p>
                )}
              </div>

              {verifier && (
                <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Verifier · {verifier.model}
                  </h3>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    reads: {verifier.assessment.make ?? "—"}{" "}
                    {verifier.assessment.model ?? "—"}
                    {verifier.assessment.colour ? `, ${verifier.assessment.colour}` : ""}{" "}
                    · class {verifier.assessment.vehicle_class} · latency{" "}
                    {verifier.latency_ms} ms
                  </p>
                  {verifier.reasoning && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        Verifier reasoning trace
                      </summary>
                      <pre className="mt-2 max-h-[30vh] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        {verifier.reasoning}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <p className="text-xs text-zinc-500">
                Prompt version {result.prompt_version} · image sha256{" "}
                <code className="text-[10px]">{result.image_sha256.slice(0, 16)}…</code>
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
