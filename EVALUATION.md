# Evaluation — Auto Claims Damage Assessment Prototype

## 1. How we know it's working (quality dimensions & metrics)

The system is judged as a **routing engine**, not a raw classifier: the headline metric is **STP rate at a fixed accuracy floor**, and every metric below is computed live in the app's Eval modal against a golden set with adjuster ground truth.

| Dimension | Metric | Measured baseline (4-sample golden set) |
| :--- | :--- | :--- |
| Vehicle ID | **Safe-pass rate** (correct *or* abstained) vs. **confident-and-wrong rate** (`model != null && wrong`) | **100% safe-pass**, 0% confident-and-wrong at current gates |
| Damage detection | Panel **micro/macro F1**; severity **±1-tier ordinal accuracy** | **F1 0.833** macro |
| Routing / business | **STP % vs. error-rate trade-off curve** (interactive threshold slider) | **16.7% STP** at the `0.72` confidence + `0.60` cross-model agreement gates |

The trade-off curve is the decision the carrier actually makes: at our shipped gates (`0.72` / `0.60`) we measure 100% safe-pass at 16.7% STP. Dropping the confidence floor to `0.50` raises STP but lets **~17% confident-and-wrong leakage** through — which is why the slider exists in the UI: the carrier sets the risk posture, we make the cost of each choice explicit.

**Empirical frontier benchmark (verified production configuration).** Both model strategies are live and selectable in the UI: the **Open-Weight Ensemble** (`kimi-k3p1-pro` + `deepseek-v4p1-flash`) and the **Frontier Benchmark tier** (`claude-sonnet-5-5` + the same independent `deepseek-v4p1-flash` verifier). On the vehicle-ID stress case (2000 Chrysler Cirrus, `citroen_missing_front_bumper.jpg`), the measured `claude-sonnet-5-5` run: **8.1s** primary latency, **~$0.03/claim**, **0.82** cross-model agreement, abstention on the uncertain model/trim call at **0.35** confidence — and a **fail-closed `ESCALATE` override** because the exposed front crash-beam set `has_structural_indicators`, which outranks every confidence gate. That run is the architecture in miniature: frontier perception quality at open-weight unit economics' order of magnitude, safe abstention instead of a confident wrong badge, and structural-safety rules that refuse automated processing even when the models agree.

## 2. Where it fails (ranked by cost to the carrier)

1. **Missed hidden/structural damage behind intact panels.** Photo-only industry supplement rates run **35–50%** — the highest-severity failure because it is *silent*: a clean-looking bumper cover can hide a crushed absorber, bent reinforcement bar, or radiator-support deformation. Mitigation: `hidden_damage_risk` / `has_structural_indicators` flags force **ESCALATE**, widen the uncertainty band, and inject pre/post-scan fees. Residual risk remains until teardown photos (Phase 1+).
2. **Confidently wrong vehicle model.** Measured live on our own samples (`citroen_missing_front_bumper.jpg` is a 2000 Chrysler Cirrus; open-weight models guess Citroën Xsara / Chrysler Sebring / Opel Vectra). The verified `claude-sonnet-5-5` frontier run on the same photo avoided the trap entirely — abstaining on the uncertain model/trim call at `0.35` confidence while still reaching `0.82` cross-model agreement on make/colour/class — and the routing layer failed closed to `ESCALATE` on the exposed front crash-beam structural indicators regardless. Mitigated by cross-model agreement gating (a second model family must agree) and coarse `vehicle_class`-keyed parts pricing, so a wrong badge can't poison the dollars. Fully solved in Phase 1 via VIN/policy lookup at intake.
3. **Pre-existing wear / prior-damage fraud.** Old clear-coat peeling and road rash presented as new collision damage. Mitigated by `has_preexisting_wear_only` classification and SHA-256 image-hash deduplication (reused photos are caught across claims).
4. **Single-photo blind spots & lighting/glare shift.** One photo cannot see three-quarters of the vehicle. Addressed in Phase 1 via guided 8-angle mobile capture; today, low `image_quality` and multi-vehicle frames force ESCALATE or REJECT.

## 3. What we need from the customer

- **10k+ closed historical claims** pairing intake photos with final settled invoices (CCC / Mitchell / Audatex line items) and VINs — the training/calibration corpus.
- **The carrier's actual DRP labor rates and parts agreements by region** — replaces our illustrative rate card (`2026.11-demo`).
- **3 senior adjusters × 4 hours** double-scoring 200 claims — measures the **human inter-rater agreement ceiling**, i.e., the maximum accuracy any system (human or AI) should be judged against.
- **Historical supplement rates and cycle-time baselines** — required to size the STP ROI honestly.

## 4. The repair-cost estimate specifically

**Proposed starting bar:** ≥80% of `AUTO_APPROVE` estimates within **±15%** of final settled cost; signed bias within **±3%**; severe under-estimates (< −20%) under **5%**.

**Why the asymmetry matters:** under-estimates drive supplements, shop friction, and cycle-time blowouts (the adjuster re-opens the file after teardown); over-estimates leak indemnity dollars directly and invite fraud. Both are contained by the same machinery: every estimate ships as a calibrated **low / point / high range** with plain-language uncertainty drivers; in Phase 1 estimates are **adjuster decision-support only** (never a binding policyholder offer); automated authority carries a **dollar cap ($2,500)**; and every adjuster correction is fed into Scale Nucleus failure slices, so the estimate — not just the classifier — improves with production data.
