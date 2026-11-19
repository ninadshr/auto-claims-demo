import type { Panel, Severity, VehicleClass } from "./schemas";
import { PANELS } from "./schemas";

/**
 * Illustrative US market rate card — NOT a carrier's actual DRP rates.
 * Phase 1 swaps this module for the carrier's real rate sheet; the costing
 * engine and tests are unchanged because they only depend on this interface.
 */

export const RATE_CARD_VERSION = "2026.11-demo";

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

export const REGIONS = [
  "US_NATIONAL",
  "US_NORTHEAST",
  "US_SOUTHEAST",
  "US_MIDWEST",
  "US_WEST",
] as const;
export type Region = (typeof REGIONS)[number];

export interface RegionalRates {
  /** $/hr body labor */
  body: number;
  /** $/hr paint labor */
  paint: number;
  /** $/hr mechanical labor */
  mechanical: number;
  /** $/hr paint materials charged per paint labor hour */
  paint_materials_per_hr: number;
  /** Sales tax on parts + materials (labor untaxed, standard US practice) */
  tax_rate: number;
}

export const REGIONAL_RATES: Record<Region, RegionalRates> = {
  US_NATIONAL: { body: 68, paint: 58, mechanical: 98, paint_materials_per_hr: 42, tax_rate: 0.07 },
  US_NORTHEAST: { body: 82, paint: 70, mechanical: 115, paint_materials_per_hr: 48, tax_rate: 0.0825 },
  US_SOUTHEAST: { body: 60, paint: 52, mechanical: 88, paint_materials_per_hr: 38, tax_rate: 0.065 },
  US_MIDWEST: { body: 64, paint: 55, mechanical: 92, paint_materials_per_hr: 40, tax_rate: 0.0675 },
  US_WEST: { body: 86, paint: 74, mechanical: 120, paint_materials_per_hr: 50, tax_rate: 0.085 },
};

// ---------------------------------------------------------------------------
// Vehicle class parts multipliers (parts only, never labor)
// ---------------------------------------------------------------------------

export const CLASS_PARTS_MULTIPLIERS: Record<VehicleClass, number> = {
  economy: 0.8,
  sedan: 1.0,
  suv: 1.25,
  luxury: 2.2,
  truck: 1.3,
  unknown: 1.05,
};

// ---------------------------------------------------------------------------
// Severity multipliers (scale REPAIR body hours) + rank for dedup
// ---------------------------------------------------------------------------

export const SEVERITY_MULTIPLIERS: Record<Severity, number> = {
  cosmetic: 0.35,
  minor: 0.65,
  moderate: 1.0,
  severe: 1.6,
  destroyed: 1.0, // forced to REPLACE; multiplier irrelevant
};

/** Ascending damage rank used to dedup repeated panels. */
export const SEVERITY_RANK: Record<Severity, number> = {
  cosmetic: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
  destroyed: 4,
};

// ---------------------------------------------------------------------------
// Area factors (affected_area_pct → REPAIR hours scaling)
// ---------------------------------------------------------------------------

export function areaFactor(affectedAreaPct: number): number {
  if (affectedAreaPct <= 10) return 0.65;
  if (affectedAreaPct <= 25) return 0.85;
  if (affectedAreaPct <= 50) return 1.0;
  if (affectedAreaPct <= 80) return 1.2;
  return 1.35;
}

// ---------------------------------------------------------------------------
// Panel table (all 28 panels)
// ---------------------------------------------------------------------------

export interface PanelRate {
  /** Base OEM parts price (sedan multiplier = 1.0) */
  parts_price: number;
  /** Body hours to R&R / replace the panel */
  replace_body_hrs: number;
  /** Base body hours to repair at moderate severity / 50% area */
  repair_body_hrs: number;
  /** Refinish hours to paint the full panel */
  paint_hrs: number;
  /** Mechanical hours (aim, calibration, glass, electrical) on replacement */
  mechanical_hrs: number;
  /** Structural weld panel — REPLACE triggers a seam-inspection note */
  weldable: boolean;
  /** Painting this panel triggers adjacent-panel colour-match blend lines */
  blendable: boolean;
}

export const PANEL_RATES: Record<Panel, PanelRate> = {
  front_bumper: { parts_price: 420, replace_body_hrs: 1.8, repair_body_hrs: 2.5, paint_hrs: 2.4, mechanical_hrs: 0.5, weldable: false, blendable: true },
  rear_bumper: { parts_price: 400, replace_body_hrs: 1.6, repair_body_hrs: 2.3, paint_hrs: 2.3, mechanical_hrs: 0.4, weldable: false, blendable: true },
  hood: { parts_price: 550, replace_body_hrs: 1.5, repair_body_hrs: 3.0, paint_hrs: 2.8, mechanical_hrs: 0.2, weldable: false, blendable: true },
  trunk_lid: { parts_price: 500, replace_body_hrs: 1.4, repair_body_hrs: 2.6, paint_hrs: 2.6, mechanical_hrs: 0.2, weldable: false, blendable: true },
  roof: { parts_price: 900, replace_body_hrs: 12.0, repair_body_hrs: 4.0, paint_hrs: 4.5, mechanical_hrs: 0.3, weldable: true, blendable: true },
  grille: { parts_price: 180, replace_body_hrs: 0.8, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 0.3, weldable: false, blendable: false },
  front_left_fender: { parts_price: 280, replace_body_hrs: 2.0, repair_body_hrs: 2.8, paint_hrs: 2.0, mechanical_hrs: 0.3, weldable: false, blendable: true },
  front_right_fender: { parts_price: 280, replace_body_hrs: 2.0, repair_body_hrs: 2.8, paint_hrs: 2.0, mechanical_hrs: 0.3, weldable: false, blendable: true },
  rear_left_quarter: { parts_price: 650, replace_body_hrs: 14.0, repair_body_hrs: 5.5, paint_hrs: 3.2, mechanical_hrs: 0.5, weldable: true, blendable: true },
  rear_right_quarter: { parts_price: 650, replace_body_hrs: 14.0, repair_body_hrs: 5.5, paint_hrs: 3.2, mechanical_hrs: 0.5, weldable: true, blendable: true },
  front_left_door: { parts_price: 720, replace_body_hrs: 2.5, repair_body_hrs: 3.0, paint_hrs: 2.6, mechanical_hrs: 0.8, weldable: false, blendable: true },
  front_right_door: { parts_price: 720, replace_body_hrs: 2.5, repair_body_hrs: 3.0, paint_hrs: 2.6, mechanical_hrs: 0.8, weldable: false, blendable: true },
  rear_left_door: { parts_price: 680, replace_body_hrs: 2.3, repair_body_hrs: 2.8, paint_hrs: 2.5, mechanical_hrs: 0.7, weldable: false, blendable: true },
  rear_right_door: { parts_price: 680, replace_body_hrs: 2.3, repair_body_hrs: 2.8, paint_hrs: 2.5, mechanical_hrs: 0.7, weldable: false, blendable: true },
  headlamp_left: { parts_price: 450, replace_body_hrs: 0.8, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 0.5, weldable: false, blendable: false },
  headlamp_right: { parts_price: 450, replace_body_hrs: 0.8, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 0.5, weldable: false, blendable: false },
  taillamp_left: { parts_price: 380, replace_body_hrs: 0.6, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 0.4, weldable: false, blendable: false },
  taillamp_right: { parts_price: 380, replace_body_hrs: 0.6, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 0.4, weldable: false, blendable: false },
  windshield: { parts_price: 420, replace_body_hrs: 0.0, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 1.2, weldable: false, blendable: false },
  rear_glass: { parts_price: 480, replace_body_hrs: 0.0, repair_body_hrs: 0.0, paint_hrs: 0.0, mechanical_hrs: 1.5, weldable: false, blendable: false },
  mirror_left: { parts_price: 240, replace_body_hrs: 0.5, repair_body_hrs: 0.4, paint_hrs: 0.3, mechanical_hrs: 0.4, weldable: false, blendable: false },
  mirror_right: { parts_price: 240, replace_body_hrs: 0.5, repair_body_hrs: 0.4, paint_hrs: 0.3, mechanical_hrs: 0.4, weldable: false, blendable: false },
  wheel_front_left: { parts_price: 340, replace_body_hrs: 0.2, repair_body_hrs: 0.5, paint_hrs: 0.4, mechanical_hrs: 0.6, weldable: false, blendable: false },
  wheel_front_right: { parts_price: 340, replace_body_hrs: 0.2, repair_body_hrs: 0.5, paint_hrs: 0.4, mechanical_hrs: 0.6, weldable: false, blendable: false },
  wheel_rear_left: { parts_price: 340, replace_body_hrs: 0.2, repair_body_hrs: 0.5, paint_hrs: 0.4, mechanical_hrs: 0.6, weldable: false, blendable: false },
  wheel_rear_right: { parts_price: 340, replace_body_hrs: 0.2, repair_body_hrs: 0.5, paint_hrs: 0.4, mechanical_hrs: 0.6, weldable: false, blendable: false },
  rocker_panel_left: { parts_price: 320, replace_body_hrs: 6.0, repair_body_hrs: 2.5, paint_hrs: 2.2, mechanical_hrs: 0.2, weldable: true, blendable: true },
  rocker_panel_right: { parts_price: 320, replace_body_hrs: 6.0, repair_body_hrs: 2.5, paint_hrs: 2.2, mechanical_hrs: 0.2, weldable: true, blendable: true },
};

// ---------------------------------------------------------------------------
// Adjacent painted panels (colour-match blend targets)
// ---------------------------------------------------------------------------

/** Directly adjacent painted body panels per panel (driver-side convention). */
export const ADJACENT_PANELS: Record<Panel, Panel[]> = {
  front_bumper: ["front_left_fender", "front_right_fender"],
  rear_bumper: ["rear_left_quarter", "rear_right_quarter"],
  hood: ["front_left_fender", "front_right_fender"],
  trunk_lid: ["rear_left_quarter", "rear_right_quarter"],
  roof: [],
  grille: [],
  front_left_fender: ["front_bumper", "hood", "front_left_door"],
  front_right_fender: ["front_bumper", "hood", "front_right_door"],
  rear_left_quarter: ["rear_bumper", "trunk_lid", "rear_left_door"],
  rear_right_quarter: ["rear_bumper", "trunk_lid", "rear_right_door"],
  front_left_door: ["front_left_fender", "rear_left_door", "rocker_panel_left"],
  front_right_door: ["front_right_fender", "rear_right_door", "rocker_panel_right"],
  rear_left_door: ["front_left_door", "rear_left_quarter", "rocker_panel_left"],
  rear_right_door: ["front_right_door", "rear_right_quarter", "rocker_panel_right"],
  headlamp_left: [],
  headlamp_right: [],
  taillamp_left: [],
  taillamp_right: [],
  windshield: [],
  rear_glass: [],
  mirror_left: [],
  mirror_right: [],
  wheel_front_left: [],
  wheel_front_right: [],
  wheel_rear_left: [],
  wheel_rear_right: [],
  rocker_panel_left: ["front_left_door", "rear_left_door"],
  rocker_panel_right: ["front_right_door", "rear_right_door"],
};

/** Human-readable panel label, e.g. `front_left_fender` → "front left fender". */
export function panelLabel(panel: Panel): string {
  return panel.replaceAll("_", " ");
}

// Compile-time guarantee that every Panel has rate-card + adjacency entries.
const _completeness: Record<Panel, true> = Object.fromEntries(
  PANELS.map((p) => [p, true]),
) as Record<Panel, true>;
void _completeness;
