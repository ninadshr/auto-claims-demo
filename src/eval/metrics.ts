import { z } from "zod";
import {
  colourFamily,
  decideRoute,
  ROUTING_THRESHOLDS,
  type RoutingSignals,
} from "../lib/confidence";
import { SEVERITY_RANK } from "../lib/rate-card";
import {
  ImageQualitySchema,
  RouteDecisionSchema,
  VehicleClassSchema,
  type RouteDecision,
} from "../lib/schemas";

/**
 * Pure golden-set metrics (plan §9) — zero LLM calls, zero network, safe to
 * import in client components. The STP-vs-accuracy sweep re-routes recorded
 * predictions through the SAME ordered routing rules the live pipeline uses
 * (`decideRoute`), so the slider shows real threshold semantics, not an
 * approximation.
 */

// ---------------------------------------------------------------------------
// Golden-set contract
// ---------------------------------------------------------------------------

const DamageItemRefSchema = z.object({
  panel: z.string(),
  severity: z.string(),
  operation: z.string(),
});

export const GoldenRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  image: z.string().nullable(),
  simulated: z.boolean(),
  expected_route: RouteDecisionSchema,
  ground_truth: z.object({
    is_vehicle: z.boolean(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    colour_family: z.string().nullable(),
    vehicle_class: VehicleClassSchema,
    damage_items: z.array(DamageItemRefSchema),
  }),
  prediction: z.object({
    is_vehicle: z.boolean(),
    image_quality: ImageQualitySchema,
    has_airbag_deployment: z.boolean(),
    has_structural_indicators: z.boolean(),
    is_total_loss_likely: z.boolean(),
    has_preexisting_wear_only: z.boolean(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    colour: z.string().nullable(),
    vehicle_class: VehicleClassSchema,
    verifier_make: z.string().nullable(),
    verifier_model: z.string().nullable(),
    agreement: z.number().min(0).max(1).nullable(),
    overall: z.number().min(0).max(1),
    vehicle_id_score: z.number().min(0).max(1),
    damage_score: z.number().min(0).max(1),
    cost_score: z.number().min(0).max(1),
    damage_items: z.array(DamageItemRefSchema),
    latency_ms: z.number().nullable().optional(),
    prompt_tokens: z.number().nullable().optional(),
    completion_tokens: z.number().nullable().optional(),
  }),
});
export type GoldenRow = z.infer<typeof GoldenRowSchema>;

/** Thresholds the interactive STP slider sweeps across (plan §10 Phase 4). */
export const SWEEP_THRESHOLDS: number[] = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
];

// ---------------------------------------------------------------------------
// Field-level correctness
// ---------------------------------------------------------------------------

function eq(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Make is correct when the ground truth is known and matched (abstention is safe, not accurate). */
export function isMakeCorrect(row: GoldenRow): boolean {
  const gt = row.ground_truth.make;
  return gt !== null && eq(row.prediction.make, gt);
}

/**
 * Fully correct = the claim an adjuster could straight-through-process
 * untouched: vehicle ID, colour family, class, and the exact panel set.
 */
export function isFullyCorrect(row: GoldenRow): boolean {
  const gt = row.ground_truth;
  if (!gt.is_vehicle) return !row.prediction.is_vehicle;
  if (!isMakeCorrect(row)) return false;
  if (gt.model !== null && !eq(row.prediction.model, gt.model)) return false;
  if (
    gt.colour_family !== null &&
    colourFamily(row.prediction.colour) !== gt.colour_family
  ) {
    return false;
  }
  if (row.prediction.vehicle_class !== gt.vehicle_class) return false;
  const gtPanels = new Set(gt.damage_items.map((d) => d.panel));
  const predPanels = new Set(row.prediction.damage_items.map((d) => d.panel));
  if (gtPanels.size !== predPanels.size) return false;
  for (const p of gtPanels) {
    if (!predPanels.has(p)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Panel F1 (micro) & severity ordinal accuracy
// ---------------------------------------------------------------------------

export interface F1 {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

/** Micro-averaged panel F1 across all rows (damage detection quality). */
export function panelF1(rows: GoldenRow[]): F1 {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    if (!row.ground_truth.is_vehicle) continue;
    const gtPanels = new Set(row.ground_truth.damage_items.map((d) => d.panel));
    const predPanels = new Set(row.prediction.damage_items.map((d) => d.panel));
    for (const p of predPanels) {
      if (gtPanels.has(p)) tp += 1;
      else fp += 1;
    }
    for (const p of gtPanels) {
      if (!predPanels.has(p)) fn += 1;
    }
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

/** Fraction of correctly detected panels whose severity is within ±1 tier. */
export function severityOrdinalAccuracy(rows: GoldenRow[]): number | null {
  let matched = 0;
  let withinOne = 0;
  for (const row of rows) {
    const byPanel = new Map(
      row.ground_truth.damage_items.map((d) => [d.panel, d] as const),
    );
    for (const pred of row.prediction.damage_items) {
      const gt = byPanel.get(pred.panel);
      if (!gt) continue;
      matched += 1;
      if (Math.abs((SEVERITY_RANK as Record<string, number>)[pred.severity] -
                   (SEVERITY_RANK as Record<string, number>)[gt.severity]) <= 1) {
        withinOne += 1;
      }
    }
  }
  return matched === 0 ? null : withinOne / matched;
}

// ---------------------------------------------------------------------------
// Threshold sweep (the interactive STP-vs-accuracy curve)
// ---------------------------------------------------------------------------

function routingSignalsOf(row: GoldenRow): RoutingSignals {
  return {
    isVehicle: row.prediction.is_vehicle,
    imageQuality: row.prediction.image_quality,
    hasAirbagDeployment: row.prediction.has_airbag_deployment,
    hasStructuralIndicators: row.prediction.has_structural_indicators,
    isTotalLossLikely: row.prediction.is_total_loss_likely,
    hasPreexistingWearOnly: row.prediction.has_preexisting_wear_only,
    damageItemCount: row.prediction.damage_items.length,
    overall: row.prediction.overall,
    damageScore: row.prediction.damage_score,
    agreement: row.prediction.agreement,
  };
}

/** Re-route a recorded prediction with an alternative AUTO_APPROVE floor. */
export function routeAtThreshold(
  row: GoldenRow,
  threshold: number,
): RouteDecision {
  return decideRoute(routingSignalsOf(row), {
    ...ROUTING_THRESHOLDS,
    overall: threshold,
  }).route;
}

export interface ThresholdPoint {
  threshold: number;
  /** Fraction of claims auto-approved (straight-through). */
  stp_rate: number;
  /** Fraction of ALL claims that are auto-approved AND wrong — the leak rate. */
  error_rate: number;
  auto_approved: number;
  confident_and_wrong: number;
  /** Per-row routing at this threshold, keyed by golden-row id. */
  routes: Record<string, RouteDecision>;
}

export function sweepThresholds(
  rows: GoldenRow[],
  thresholds: number[] = SWEEP_THRESHOLDS,
): ThresholdPoint[] {
  return thresholds.map((threshold) => {
    const routes: Record<string, RouteDecision> = {};
    let autoApproved = 0;
    let confidentAndWrong = 0;
    for (const row of rows) {
      const route = routeAtThreshold(row, threshold);
      routes[row.id] = route;
      if (route === "AUTO_APPROVE") {
        autoApproved += 1;
        if (!isFullyCorrect(row)) confidentAndWrong += 1;
      }
    }
    const total = rows.length;
    return {
      threshold,
      stp_rate: total === 0 ? 0 : autoApproved / total,
      error_rate: total === 0 ? 0 : confidentAndWrong / total,
      auto_approved: autoApproved,
      confident_and_wrong: confidentAndWrong,
      routes,
    };
  });
}

// ---------------------------------------------------------------------------
// Baseline metrics
// ---------------------------------------------------------------------------

export interface BaselineMetrics {
  sample_count: number;
  threshold: number;
  panel_f1: F1;
  severity_ordinal_accuracy: number | null;
  colour_family_accuracy: number | null;
  make_accuracy: number | null;
  /** Claims either NOT auto-approved, or auto-approved and fully correct. */
  safe_pass_rate: number;
  /** Auto-approved AND wrong, as a fraction of all claims. */
  confident_and_wrong_rate: number;
  stp_rate: number;
}

export function baselineMetrics(
  rows: GoldenRow[],
  threshold: number = ROUTING_THRESHOLDS.overall,
): BaselineMetrics {
  const total = rows.length;

  const colourRows = rows.filter((r) => r.ground_truth.colour_family !== null);
  const colourAccuracy =
    colourRows.length === 0
      ? null
      : colourRows.filter(
          (r) => colourFamily(r.prediction.colour) === r.ground_truth.colour_family,
        ).length / colourRows.length;

  const makeRows = rows.filter((r) => r.ground_truth.make !== null);
  const makeAccuracy =
    makeRows.length === 0
      ? null
      : makeRows.filter(isMakeCorrect).length / makeRows.length;

  let safePass = 0;
  let stp = 0;
  let confidentWrong = 0;
  for (const row of rows) {
    const route = routeAtThreshold(row, threshold);
    if (route === "AUTO_APPROVE") {
      stp += 1;
      if (isFullyCorrect(row)) safePass += 1;
      else confidentWrong += 1;
    } else {
      // Removed from automation — safe by construction (human sees it).
      safePass += 1;
    }
  }

  return {
    sample_count: total,
    threshold,
    panel_f1: panelF1(rows),
    severity_ordinal_accuracy: severityOrdinalAccuracy(rows),
    colour_family_accuracy: colourAccuracy,
    make_accuracy: makeAccuracy,
    safe_pass_rate: total === 0 ? 0 : safePass / total,
    confident_and_wrong_rate: total === 0 ? 0 : confidentWrong / total,
    stp_rate: total === 0 ? 0 : stp / total,
  };
}
