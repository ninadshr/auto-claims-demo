"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Car,
  FileJson,
  FlaskConical,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import UploadPanel, { type AnalyzeOptions } from "./UploadPanel";
import ResultsDashboard from "./ResultsDashboard";
import CostBreakdownTable from "./CostBreakdownTable";
import FlywheelDrawer from "./FlywheelDrawer";
import EvalModal from "./EvalModal";
import type { AnalysisResult } from "@/lib/analysis";
import type { EvalResponse } from "@/eval/api-types";
import type { ModelTierInfo } from "@/lib/providers/types";

/** Single-page interactive workbench (plan §4 layout: page.tsx → Workbench). */
export default function Workbench() {
  const [options, setOptions] = useState<AnalyzeOptions>({
    modelTier: "open-weight",
    region: "US_NATIONAL",
    acv: "",
  });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flywheelOpen, setFlywheelOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalData, setEvalData] = useState<EvalResponse | null>(null);
  const [tiers, setTiers] = useState<ModelTierInfo[]>([]);

  // One fetch feeds the model-tier badges and the eval modal's baseline.
  useEffect(() => {
    fetch("/api/eval")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: EvalResponse) => {
        setEvalData(json);
        setTiers(json.model_tiers);
      })
      .catch(() => setTiers([]));
  }, []);

  const run = async (label: string, send: () => Promise<Response>) => {
    setBusy(true);
    setBusyLabel(label);
    setError(null);
    try {
      const res = await send();
      const json = (await res.json()) as AnalysisResult & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(
          json.error
            ? `${json.error}${json.detail ? ` — ${json.detail}` : ""}`
            : `HTTP ${res.status}`,
        );
      }
      setResult(json);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const analyzeFile = (file: File) => {
    void run(`Analyzing ${file.name || "upload"}…`, () => {
      const form = new FormData();
      form.append("image", file);
      form.append("modelTier", options.modelTier);
      form.append("region", options.region);
      if (options.acv) form.append("acv", options.acv);
      return fetch("/api/analyze", { method: "POST", body: form });
    });
  };

  const analyzeUrl = (url: string) => {
    void run("Fetching and analyzing image URL…", () =>
      fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: url,
          modelTier: options.modelTier,
          region: options.region,
          ...(options.acv ? { acv: Number(options.acv) } : {}),
        }),
      }),
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-bold tracking-tight">
                Claims Triage &amp; AI Architecture Workbench
              </h1>
              <p className="text-xs text-zinc-500">
                Adjuster decision-support · confidence-gated straight-through
                processing · Scale AI flywheel · prompt v1.0
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEvalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium transition hover:border-emerald-500 hover:text-emerald-700 dark:border-zinc-700 dark:hover:text-emerald-300"
            >
              <FlaskConical className="h-4 w-4" />
              Evaluation &amp; STP Simulator
            </button>
            <button
              type="button"
              disabled={!result}
              onClick={() => setFlywheelOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium transition enabled:hover:border-amber-500 enabled:hover:text-amber-700 disabled:opacity-40 dark:border-zinc-700 dark:enabled:hover:text-amber-300"
            >
              <FileJson className="h-4 w-4" />
              Scale Flywheel
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[400px_1fr]">
        <UploadPanel
          tiers={tiers}
          options={options}
          onOptionsChange={setOptions}
          onAnalyzeFile={analyzeFile}
          onAnalyzeUrl={analyzeUrl}
          busy={busy}
        />

        <section className="flex flex-col gap-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-semibold">Analysis failed.</strong>{" "}
                <span className="font-mono text-xs">{error}</span>
              </div>
            </div>
          )}

          {busy && (
            <div className="flex items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white p-12 text-sm font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              {busyLabel} Two vision models are running concurrently — this
              takes 30–120&nbsp;seconds.
            </div>
          )}

          {!busy && !result && !error && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white p-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
              <Car className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Upload a claim photo or pick a demo sample
              </h2>
              <p className="max-w-md text-xs leading-relaxed text-zinc-500">
                The vision ensemble extracts structured physical facts — never
                dollars. The deterministic rate-card engine computes every
                cent, and confidence gates decide whether the claim is
                straight-through processed, escalated to a human, or rejected.
              </p>
            </div>
          )}

          {result && (
            <>
              <ResultsDashboard
                result={result}
                onOpenFlywheel={() => setFlywheelOpen(true)}
              />
              <CostBreakdownTable estimate={result.estimate} />
            </>
          )}
        </section>
      </main>

      <FlywheelDrawer
        open={flywheelOpen}
        result={result}
        onClose={() => setFlywheelOpen(false)}
      />
      <EvalModal
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        data={evalData}
        options={options}
      />
    </div>
  );
}
