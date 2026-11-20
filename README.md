# Auto Claims Damage Assessment — AI Triage & Estimate Prototype

**Live demo:** `https://auto-claims-demo.vercel.app`

This prototype is an **adjuster decision-support & straight-through-processing (STP) triage engine** for a high-volume US auto carrier. A customer submits a single claim photo; an ensemble of open-weight vision models extracts *structured physical damage facts* (never dollars); a deterministic TypeScript rate-card engine prices parts, labor, paint, blends, and fees; and a per-field confidence + cross-model-agreement router decides whether the claim is **AUTO_APPROVE**, **ESCALATE** to a human, or **REJECT**. Uncertain or safety-critical slices flow into Scale AI human-labeling and Nucleus slice-curation adapters, closing the data flywheel that makes the next model better.

## Quickstart

```bash
npm install
cp .env.example .env.local        # add FIREWORKS_API_KEY (required); frontier/Scale keys optional
npm run dev                       # http://localhost:3000
npx vitest run                    # deterministic engine + metrics unit tests
```

Without any API keys the app still runs: the costing, routing, eval, and Scale-flywheel machinery are pure TypeScript and fully testable offline; live vision inference simply requires `FIREWORKS_API_KEY`.

## Architecture & data flow

```text
┌──────────┐   file / URL / sample   ┌──────────────────────────────────────────────┐
│ Browser  │ ──────────────────────► │ Next.js API  (SSRF-safe URL fetch, MIME/size │
│ (React + │      POST /api/analyze  │ checks, SHA-256 hash, base64 data-URI)       │
│ Tailwind)│                        └──────────────────┬───────────────────────────┘
└──────────┘                                           │  Promise.allSettled (concurrent)
                                       ┌───────────────┴────────────────┐
                                       ▼                                ▼
                        PRIMARY OPEN-WEIGHT VISION         OPEN-WEIGHT VERIFIER
                        kimi-k3p1-pro (Fireworks)          deepseek-v4p1-flash
                        strict json_schema + reasoning     slim vehicle-ID schema
                                       │          ( frontier benchmark adapter:  )
                                       │          ( claude-sonnet-5-5 / gpt-4o /  )
                                       │          ( gemini-flash, env-gated       )
                                       └───────────────┬────────────────┘
                                                       ▼
                                    Zod validation (closed enums: 28 panels,
                                    severity, operation, vehicle_class)
                                                       ▼
                         DETERMINISTIC RATE-CARD ENGINE  (src/lib/costing.ts)
                         parts × class multiplier · body/paint/mech hours ·
                         auto BLEND lines · ADAS scan · fees & tax ·
                         low / point / high uncertainty band · total-loss flag
                         — ZERO LLM CALLS, ZERO DOLLARS FROM ANY MODEL —
                                                       ▼
                         CONFIDENCE & AGREEMENT ROUTING  (src/lib/confidence.ts)
                         per-field confidences × cross-model agreement →
                         AUTO_APPROVE  |  ESCALATE  |  REJECT  (+ reasons)
                                                       ▼
                         SCALE AI FLYWHEEL  (src/lib/integrations/)
                         Scale API human-labeling escalation (ESCALATE route) ·
                         Nucleus failure-slice tagging (wear / disagreement /
                         hidden-risk / structural) — live via env keys, else
                         simulated locally in the Flywheel Inspector drawer
```

The architectural invariant that holds it all together: **the VLM never outputs a dollar figure.** Models perceive; TypeScript prices. Every panel, severity, operation, and vehicle class is a closed enum (`zod` + strict `json_schema`), so free text can never reach the pricing engine and every output is scoreable against adjuster ground truth.

## Why we chose these tools (defending the trade-offs)

- **Deterministic rate-card math instead of VLM dollar guessing.** An LLM that "estimates $1,850" produces an uncalibrated, indefensible number: it can't cite regional labor rates, OEM/DRP parts discounts, or tax treatment, and it changes when the prompt does. Our engine is auditable line by line (a regulator can read `rate-card.ts`), and the carrier tunes pricing by editing a data table — no prompt engineering, no model re-deploy, provably reproducible estimates.
- **Open-weight Fireworks ensemble + optional frontier routing.** Both model strategies are live and selectable in the UI's Model Strategy selector: the **Open-Weight Ensemble** (primary `kimi-k3p1-pro` + verifier `deepseek-v4p1-flash`, our default) and the **Frontier Benchmark tier** (primary `claude-sonnet-5-5` **Claude Sonnet 5.5** + the same independent `deepseek-v4p1-flash` verifier). The open-weight ensemble runs concurrently for **~$0.01–$0.03 per claim** (shown live per-response in the UI from token telemetry), with zero data retention on Fireworks and a clear path to **custom fine-tuning once the carrier supplies 10k+ labeled claims**. Running two *different model families* on the same photo is also a cheap hallucination detector: cross-family disagreement on make/model — measured live on our Chrysler-Cirrus sample — is a routing signal, not just a UI badge. On that same stress case, the verified frontier configuration (`claude-sonnet-5-5` + `deepseek-v4p1-flash`) measured **8.1s** primary latency at **~$0.03/claim**, **0.82** cross-model agreement, abstention on the uncertain model/trim call at **0.35** confidence, and a fail-closed **ESCALATE** override on exposed front crash-beam structural damage indicators — the routing layer correctly refused automated processing even with agreement above the gate. Frontier models (Claude / GPT / Gemini) sit behind the same provider interface, env-gated, for side-by-side comparison during evaluation; the system is model-agnostic by design.
- **Scale API + Scale Nucleus adapters.** The prototype's value compounds only if uncertain claims produce labeled data. ESCALATE routes build Scale human-annotation task payloads (hypothesis-prefilled from the VLM output); every assessment is tagged with Nucleus slice metadata (`vehicle_id_disagreement`, `preexisting_wear`, `high_hidden_risk`, `structural_flag`) so failures automatically populate curated regression slices. Both run standalone in local demo mode (payloads surfaced in the Flywheel Inspector drawer) and activate live when `SCALE_API_KEY` / `NUCLEUS_API_KEY` are set — zero hard dependency.
- **Vercel + Next.js for the prototype vs. production hardening.** For a 4-hour, customer-facing demo, Vercel gives instant HTTPS deploys, zero infra, and serverless API routes with the same code that runs locally. Production adds: private VPC deployment with WAF and OAuth/SSO, carrier identity integration, VIN/policy-system lookup at intake, DRP rate-sheet ingestion, audit logging, and PCI/SOC2-aligned data handling — all swaps behind the existing provider/adapter interfaces, none of which change the core routing architecture.

## Phased roadmap & entry gates

| Phase | Scope | Entry gate (we don't advance without it) |
| :--- | :--- | :--- |
| **1 — Shadow mode** | Run alongside human adjusters on live claims; VIN/policy lookup at intake; carrier DRP rate sheets replace the demo card; guided 8-angle mobile capture; adjuster edits captured. | Meets the repair-cost SLA below on shadow claims **with zero automated authority**. |
| **2 — Bounded STP** | Enable AUTO_APPROVE for a bounded slice (single-panel, low hidden-damage-risk, ≤ $2,500) with the confidence + agreement gates live. | ≥80% of automated estimates within ±15% of settled cost, signed bias ±3%, severe under-estimates <5%, and supplement rate no worse than the human baseline. |
| **3 — Multi-angle + custom fine-tuned classifier** | Fine-tune on the carrier's 10k+ labeled claims (via the Nucleus flywheel corpus); 8-angle structural reasoning; total-loss and airbag-path automation. | Outperforms the measured **human inter-rater agreement ceiling** on the double-scored 200-claim benchmark. |

Full evaluation framework — metrics, ranked failure modes, customer data requirements, and the repair-cost accuracy bars — is in [`EVALUATION.md`](EVALUATION.md).

## What we would do next with more time

- **VIN/plate → exact vehicle resolution** at intake (kills the confidently-wrong-model failure class outright) and real OEM parts pricing keyed to the VIN, not just vehicle class.
- **Guided multi-angle capture flow** (8 angles + VIN photo + odometer) in a mobile-first policyholder flow, with live image-quality feedback before submission.
- **Calibration layer on settled-claims data**: fit the low/point/high band empirically per panel and severity instead of the current heuristic multipliers.
- **Teardown/supplement photo ingestion** to attack the #1 failure mode — hidden structural damage behind intact bumper covers.
- **Fraud signals beyond image hash**: prior-claim cross-reference, metadata forensics, and editing-artifact detection.
- **Full audit log** (every prompt version, model output, and rate-card version per claim) for regulator-facing reproducibility.

## Sample image attribution

The four demo images in `public/samples/` are Wikimedia Commons photos (CC BY / CC BY-SA / public domain); sources, authors, and licenses are listed in [`public/samples/ATTRIBUTION.md`](public/samples/ATTRIBUTION.md). They intentionally map to the four routing scenarios: severe collision (ESCALATE), moderate bumper damage (AUTO_APPROVE candidate), vehicle-ID disagreement stress test, and undamaged/pre-existing-wear (REJECT).

---

**Demo disclaimer:** rate-card figures (`rate_card_version: 2026.11-demo`) are illustrative US market values, not a carrier's actual DRP pricing; Phase 1 replaces them with the carrier's rate sheet. Estimates are decision-support for adjusters, never binding policyholder offers.
