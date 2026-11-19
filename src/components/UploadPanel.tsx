"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Link2, Sparkles, Upload } from "lucide-react";
import type { ModelTier } from "@/lib/providers/types";
import type { ModelTierInfo } from "@/lib/providers/types";
import { REGIONS } from "@/lib/rate-card";
import type { Region } from "@/lib/rate-card";

/** The 4 demo samples with their verified pixel dimensions. */
export const SAMPLES = [
  {
    file: "/samples/citroen_missing_front_bumper.jpg",
    label: "Vehicle-ID disagreement",
    hint: "Missing front bumper — Cirrus vs. Concorde",
    expectedRoute: "ESCALATE",
    width: 1280,
    height: 720,
  },
  {
    file: "/samples/broken_front_bumper.jpg",
    label: "Moderate bumper damage",
    hint: "AUTO_APPROVE candidate — watch the verifier",
    expectedRoute: "AUTO_APPROVE",
    width: 1280,
    height: 717,
  },
  {
    file: "/samples/accident_damaged_car.jpg",
    label: "Severe front-end collision",
    hint: "Structural indicators + abstained vehicle ID",
    expectedRoute: "ESCALATE",
    width: 1280,
    height: 853,
  },
  {
    file: "/samples/clean_car.jpg",
    label: "Clean car — pre-existing wear",
    hint: "No collision damage to assess",
    expectedRoute: "REJECT",
    width: 1280,
    height: 831,
  },
] as const;

export interface AnalyzeOptions {
  modelTier: ModelTier;
  region: Region;
  acv: string;
}

interface UploadPanelProps {
  tiers: ModelTierInfo[];
  options: AnalyzeOptions;
  onOptionsChange: (options: AnalyzeOptions) => void;
  onAnalyzeFile: (file: File) => void;
  onAnalyzeUrl: (url: string) => void;
  busy: boolean;
}

const ROUTE_CHIP: Record<string, string> = {
  AUTO_APPROVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  ESCALATE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  REJECT: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export default function UploadPanel({
  tiers,
  options,
  onOptionsChange,
  onAnalyzeFile,
  onAnalyzeUrl,
  busy,
}: UploadPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const acceptFile = (file: File | undefined | null) => {
    if (!file || busy) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return; // the server's magic-byte sniffing is the authority
    }
    setPreview(URL.createObjectURL(file));
    onAnalyzeFile(file);
  };

  const runSample = async (path: string) => {
    if (busy) return;
    const blob = await fetch(path).then((r) => r.blob());
    const name = path.split("/").pop() ?? "sample.jpg";
    acceptFile(new File([blob], name, { type: blob.type || "image/jpeg" }));
  };

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* --- Drag & drop --- */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Claim photo
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          className={`mt-2 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
            dragOver
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
          } ${busy ? "opacity-50" : ""}`}
        >
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element -- object URL preview, not a static asset */
            <img
              src={preview}
              alt="Selected claim photo preview"
              className="max-h-40 rounded-md object-contain"
            />
          ) : (
            <>
              <Upload className="h-6 w-6 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Drag & drop, or click to browse
              </span>
              <span className="text-xs text-zinc-500">
                JPEG / PNG / WebP · up to 10 MB
              </span>
            </>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
      </div>

      {/* --- Image URL --- */}
      <div>
        <label
          htmlFor="image-url"
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        >
          …or an image URL
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="image-url"
            type="url"
            value={url}
            placeholder="https://example.com/car.jpg"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url && !busy) onAnalyzeUrl(url);
            }}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <button
            type="button"
            disabled={busy || !url}
            onClick={() => onAnalyzeUrl(url)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Link2 className="h-4 w-4" />
            Fetch
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          SSRF-guarded: private and loopback addresses are blocked server-side.
        </p>
      </div>

      {/* --- Sample cards --- */}
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Demo samples
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.file}
              type="button"
              disabled={busy}
              onClick={() => runSample(sample.file)}
              className="group overflow-hidden rounded-lg border border-zinc-200 text-left transition hover:border-emerald-500 hover:shadow-sm disabled:opacity-50 dark:border-zinc-800 dark:hover:border-emerald-500"
            >
              <Image
                src={sample.file}
                alt={sample.label}
                width={sample.width}
                height={sample.height}
                className="h-20 w-full object-cover"
              />
              <div className="p-2">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${ROUTE_CHIP[sample.expectedRoute]}`}
                >
                  {sample.expectedRoute}
                </span>
                <p className="mt-1 text-xs font-medium leading-tight text-zinc-800 dark:text-zinc-200">
                  {sample.label}
                </p>
                <p className="text-[11px] leading-tight text-zinc-500">{sample.hint}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* --- Controls --- */}
      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div>
          <label
            htmlFor="model-tier"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            Model tier
          </label>
          <select
            id="model-tier"
            value={options.modelTier}
            disabled={busy}
            onChange={(e) =>
              onOptionsChange({ ...options, modelTier: e.target.value as ModelTier })
            }
            className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {tiers.map((tier) => (
              <option
                key={tier.tier}
                value={tier.tier}
                disabled={!tier.available}
              >
                {tier.tier === "open-weight"
                  ? "Open-Weight Ensemble — Kimi K3.1 Pro + DeepSeek V4.1 Verifier"
                  : `${tier.label} — ${tier.model}`}
                {tier.available ? "" : ` (key not set: ${tier.reason})`}
              </option>
            ))}
          </select>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tiers.map((tier) => (
              <span
                key={tier.tier}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  tier.available
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    tier.available ? "bg-emerald-500" : "bg-zinc-400"
                  }`}
                />
                {tier.tier === "open-weight" ? "Open-Weight" : tier.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="region"
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            >
              US region
            </label>
            <select
              id="region"
              value={options.region}
              disabled={busy}
              onChange={(e) =>
                onOptionsChange({ ...options, region: e.target.value as Region })
              }
              className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="acv"
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Vehicle ACV ($){" "}
              <span className="font-normal text-zinc-400">optional</span>
            </label>
            <input
              id="acv"
              type="number"
              min={0}
              placeholder="e.g. 6500"
              value={options.acv}
              disabled={busy}
              onChange={(e) => onOptionsChange({ ...options, acv: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          ACV feeds the deterministic total-loss trigger (estimate ≥ 75% of ACV).
        </p>
      </div>
    </div>
  );
}
