import type {
  DamageItem,
  Operation,
  Panel,
  VehicleClass,
  VisionAssessment,
} from "./schemas";
import {
  ADJACENT_PANELS,
  CLASS_PARTS_MULTIPLIERS,
  PANEL_RATES,
  RATE_CARD_VERSION,
  REGIONAL_RATES,
  SEVERITY_MULTIPLIERS,
  SEVERITY_RANK,
  areaFactor,
  panelLabel,
  type Region,
} from "./rate-card";

/**
 * Pure deterministic costing engine — ZERO LLM calls, ZERO network calls.
 * All dollar math for the application lives here and nowhere else.
 *
 * Rates are illustrative US market figures (`RATE_CARD_VERSION`); Phase 1
 * replaces the rate card with the carrier's actual DRP rate sheet.
 */

export type EstimateOperation = Operation | "BLEND";

export interface CostLineItem {
  panel: Panel;
  operation: EstimateOperation;
  description: string;
  parts_usd: number;
  body_hrs: number;
  paint_hrs: number;
  mechanical_hrs: number;
  labor_usd: number;
  materials_usd: number;
  line_total_usd: number;
}

export interface CostEstimate {
  rate_card_version: string;
  region: Region;
  currency: "USD";
  disclaimer: string;
  line_items: CostLineItem[];
  totals: {
    parts_usd: number;
    labor_usd: number;
    materials_usd: number;
    pre_post_scan_usd: number;
    shop_supplies_usd: number;
    hazmat_usd: number;
    tax_usd: number;
    point_usd: number;
  };
  uncertainty: {
    band: number;
    low_usd: number;
    point_usd: number;
    high_usd: number;
    reasons: string[];
  };
  is_total_loss_likely: boolean;
  total_loss_reasons: string[];
  warnings: string[];
  notes: string[];
}

export interface CostingInput {
  assessment: VisionAssessment;
  region?: Region;
  /** Actual Cash Value of the vehicle, if supplied by the adjuster. */
  acvUsd?: number;
}

const DISCLAIMER =
  "Estimate uses illustrative US market rates (not the carrier's DRP rate sheet). Adjuster decision-support only — never a binding policyholder offer.";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Resolve the effective operation for a damage item (DESTROYED forces REPLACE). */
function resolveOperation(item: DamageItem): { operation: Operation; forced: boolean } {
  if (item.severity === "destroyed" && item.recommended_operation !== "REPLACE") {
    return { operation: "REPLACE", forced: true };
  }
  return { operation: item.recommended_operation, forced: false };
}

/** Deduplicate repeated panels, keeping the highest-severity item. */
function deduplicateItems(items: DamageItem[]): { items: DamageItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const byPanel = new Map<Panel, DamageItem>();
  for (const item of items) {
    const existing = byPanel.get(item.panel);
    if (!existing) {
      byPanel.set(item.panel, item);
      continue;
    }
    const keep = SEVERITY_RANK[item.severity] >= SEVERITY_RANK[existing.severity] ? item : existing;
    byPanel.set(item.panel, keep);
    warnings.push(
      `Duplicate panel '${item.panel}': kept '${keep.severity}' item, dropped lower-severity duplicate.`,
    );
  }
  return { items: [...byPanel.values()], warnings };
}

function buildDamageLine(
  item: DamageItem,
  operation: Operation,
  region: Region,
  vehicleClass: VehicleClass,
): CostLineItem {
  const rate = PANEL_RATES[item.panel];
  const rates = REGIONAL_RATES[region];
  const classMultiplier = CLASS_PARTS_MULTIPLIERS[vehicleClass];

  const parts =
    operation === "REPLACE" ? rate.parts_price * classMultiplier : 0;

  const bodyHrs =
    operation === "REPLACE"
      ? rate.replace_body_hrs
      : operation === "REPAIR"
        ? rate.repair_body_hrs *
          SEVERITY_MULTIPLIERS[item.severity] *
          areaFactor(item.affected_area_pct)
        : 0.5; // INSPECT

  const paintHrs =
    operation === "REPLACE" || operation === "REPAIR"
      ? rate.paint_hrs * (item.paint_type === "multi_stage" ? 1.25 : 1.0)
      : 0;

  const mechHrs = operation === "REPLACE" ? rate.mechanical_hrs : 0;

  const body = round2(bodyHrs);
  const paint = round2(paintHrs);
  const mech = round2(mechHrs);

  const labor = round2(
    body * rates.body + paint * rates.paint + mech * rates.mechanical,
  );
  const materials = round2(paint * rates.paint_materials_per_hr);
  const partsUsd = round2(parts);

  const opLabel = operation === "INSPECT" ? "INSPECT" : operation;
  const detail =
    operation === "REPAIR"
      ? ` (${item.severity}, ${item.affected_area_pct}% area)`
      : "";
  const description = `${opLabel} ${panelLabel(item.panel)}${detail}`;

  return {
    panel: item.panel,
    operation,
    description,
    parts_usd: partsUsd,
    body_hrs: body,
    paint_hrs: paint,
    mechanical_hrs: mech,
    labor_usd: labor,
    materials_usd: materials,
    line_total_usd: round2(partsUsd + labor + materials),
  };
}

function buildBlendLine(
  targetPanel: Panel,
  region: Region,
): CostLineItem {
  const rates = REGIONAL_RATES[region];
  const paintHrs = round2(0.5 * PANEL_RATES[targetPanel].paint_hrs);
  const labor = round2(paintHrs * rates.paint);
  const materials = round2(paintHrs * rates.paint_materials_per_hr);
  return {
    panel: targetPanel,
    operation: "BLEND",
    description: `Colour-match blend: ${panelLabel(targetPanel)}`,
    parts_usd: 0,
    body_hrs: 0,
    paint_hrs: paintHrs,
    mechanical_hrs: 0,
    labor_usd: labor,
    materials_usd: materials,
    line_total_usd: round2(labor + materials),
  };
}

/**
 * Compute the deterministic repair cost estimate for a validated assessment.
 * No LLM, no network — safe to unit test and to audit line by line.
 */
export function computeCostEstimate(input: CostingInput): CostEstimate {
  const { assessment } = input;
  const region = input.region ?? "US_NATIONAL";
  const rates = REGIONAL_RATES[region];
  const vehicleClass = assessment.vehicle.vehicle_class;

  const notes: string[] = [];
  const { items, warnings } = deduplicateItems(assessment.damage_items);

  // --- Resolve operations & structural notes -------------------------------
  const resolved = items.map((item) => {
    const { operation, forced } = resolveOperation(item);
    if (forced) {
      notes.push(
        `Severity 'destroyed' forces REPLACE for ${panelLabel(item.panel)}.`,
      );
    }
    if (operation === "REPLACE" && PANEL_RATES[item.panel].weldable) {
      notes.push(
        `${panelLabel(item.panel)} replacement is a structural weld panel — shop-floor seam inspection required.`,
      );
    }
    return { item, operation };
  });

  // --- Damage line items ---------------------------------------------------
  const damageLines = resolved.map(({ item, operation }) =>
    buildDamageLine(item, operation, region, vehicleClass),
  );

  // --- Auto-injected colour-match blend lines ------------------------------
  const panelsInEstimate = new Set<Panel>(items.map((i) => i.panel));
  const blendedPanels = new Set<Panel>();
  const blendLines: CostLineItem[] = [];
  for (const { item, operation } of resolved) {
    const rate = PANEL_RATES[item.panel];
    if (!(operation === "REPLACE" || operation === "REPAIR") || !rate.blendable) {
      continue;
    }
    for (const adjacent of ADJACENT_PANELS[item.panel]) {
      if (panelsInEstimate.has(adjacent) || blendedPanels.has(adjacent)) continue;
      if (PANEL_RATES[adjacent].paint_hrs <= 0) continue;
      blendedPanels.add(adjacent);
      blendLines.push(buildBlendLine(adjacent, region));
    }
  }

  const lineItems = [...damageLines, ...blendLines];

  // --- Totals ---------------------------------------------------------------
  const totalParts = round2(
    lineItems.reduce((sum, l) => sum + l.parts_usd, 0),
  );
  const totalLabor = round2(
    lineItems.reduce((sum, l) => sum + l.labor_usd, 0),
  );
  const totalMaterials = round2(
    lineItems.reduce((sum, l) => sum + l.materials_usd, 0),
  );
  const totalPaintHrs = round2(
    lineItems.reduce((sum, l) => sum + l.paint_hrs, 0),
  );

  const anyReplace = lineItems.some((l) => l.operation === "REPLACE");
  const prePostScan =
    anyReplace || assessment.has_structural_indicators ? 125 : 0;
  const shopSupplies = round2(Math.min(35, 0.04 * totalLabor));
  const hazmat = totalPaintHrs > 0 ? round2(0.02 * totalLabor) : 0;
  const tax = round2(rates.tax_rate * (totalParts + totalMaterials));
  const pointUsd = round2(
    totalParts + totalLabor + totalMaterials + prePostScan + shopSupplies + hazmat + tax,
  );

  // --- Uncertainty band -----------------------------------------------------
  const reasons: string[] = ["Base ±15% band for photo-based estimating."];
  let band = 0.15;
  if (assessment.hidden_damage_risk === "medium") {
    band += 0.1;
    reasons.push("Medium hidden-damage risk widens band (+10%).");
  } else if (assessment.hidden_damage_risk === "high") {
    band += 0.22;
    reasons.push("High hidden-damage risk widens band (+22%).");
  }
  if (assessment.has_structural_indicators) {
    band += 0.25;
    reasons.push("Structural damage indicators widen band (+25%).");
  }
  if (assessment.image_quality === "poor") {
    band += 0.15;
    reasons.push("Poor image quality widens band (+15%).");
  }
  const singleCosmetic =
    items.length === 1 && items[0].severity === "cosmetic";
  if (singleCosmetic) {
    band -= 0.05;
    reasons.push("Single cosmetic item narrows band (-5%).");
  }
  const clampedBand = round2(clamp(band, 0.12, 0.6));
  if (clampedBand !== round2(band)) {
    reasons.push(`Band clamped from ${Math.round(band * 100)}% to ${clampedBand * 100}%.`);
  }

  // --- Total loss flag --------------------------------------------------------
  const totalLossReasons: string[] = [];
  let isTotalLossLikely = false;
  if (input.acvUsd !== undefined && pointUsd >= 0.75 * input.acvUsd) {
    isTotalLossLikely = true;
    totalLossReasons.push(
      `Point estimate $${pointUsd.toFixed(2)} ≥ 75% of ACV $${input.acvUsd.toFixed(2)}.`,
    );
  }
  if (assessment.has_airbag_deployment) {
    isTotalLossLikely = true;
    totalLossReasons.push("Airbag deployment detected.");
  }

  return {
    rate_card_version: RATE_CARD_VERSION,
    region,
    currency: "USD",
    disclaimer: DISCLAIMER,
    line_items: lineItems,
    totals: {
      parts_usd: totalParts,
      labor_usd: totalLabor,
      materials_usd: totalMaterials,
      pre_post_scan_usd: prePostScan,
      shop_supplies_usd: shopSupplies,
      hazmat_usd: hazmat,
      tax_usd: tax,
      point_usd: pointUsd,
    },
    uncertainty: {
      band: clampedBand,
      low_usd: round2(pointUsd * (1 - clampedBand)),
      point_usd: pointUsd,
      high_usd: round2(pointUsd * (1 + clampedBand)),
      reasons,
    },
    is_total_loss_likely: isTotalLossLikely,
    total_loss_reasons: totalLossReasons,
    warnings,
    notes,
  };
}
