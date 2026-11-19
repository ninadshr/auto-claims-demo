import type {
  ImageQuality,
  RouteDecision,
  VerifierAssessment,
  VisionAssessment,
} from "./schemas";

/**
 * Per-field confidence scoring, cross-model agreement, and STP routing.
 * Confidence GATES routing (AUTO_APPROVE / ESCALATE / REJECT) — it is a
 * business control, not a UI badge. The headline metric is STP rate at a
 * fixed accuracy bar, which is why low confidence removes a claim from
 * automated processing instead of merely flagging it.
 */

// ---------------------------------------------------------------------------
// Inputs & outputs
// ---------------------------------------------------------------------------

export interface ConfidenceInput {
  assessment: VisionAssessment;
  /** Slim vehicle-ID result from the independent verifier model, if it ran. */
  verifier?: VerifierAssessment | null;
  /** Total-loss flag from the deterministic costing engine. */
  isTotalLossLikely?: boolean;
}

export interface ConfidenceResult {
  /** Cross-model agreement score 0.0–1.0, or null when no verifier ran. */
  agreement: number | null;
  disagreements: string[];
  vehicle_id_score: number;
  damage_score: number;
  cost_score: number;
  overall: number;
  route: RouteDecision;
  routing_reasons: string[];
}

// ---------------------------------------------------------------------------
// Tunable factors
// ---------------------------------------------------------------------------

const QUALITY_FACTORS: Record<ImageQuality, number> = {
  good: 1.0,
  acceptable: 0.9,
  poor: 0.75,
  unusable: 0.5,
};

const HIDDEN_RISK_FACTORS = { low: 1.0, medium: 0.9, high: 0.75 } as const;

/** Routing thresholds — surfaced as the STP threshold slider in the UI. */
export const ROUTING_THRESHOLDS = {
  overall: 0.72,
  damage: 0.7,
  agreement: 0.6,
} as const;

// ---------------------------------------------------------------------------
// Colour-family matching
// ---------------------------------------------------------------------------

const COLOUR_FAMILY_SYNONYMS: Record<string, string[]> = {
  black: ["black", "obsidian", "onyx"],
  white: ["white", "pearl", "ivory"],
  silver: ["silver"],
  grey: ["gray", "grey", "graphite", "charcoal", "slate", "pewter"],
  red: ["red", "crimson", "scarlet", "burgundy", "maroon", "garnet"],
  blue: ["blue", "navy", "azure", "cobalt", "sapphire", "teal"],
  green: ["green", "emerald", "olive", "evergreen"],
  yellow: ["yellow", "gold", "mustard"],
  orange: ["orange", "copper", "amber"],
  brown: ["brown", "tan", "beige", "bronze", "champagne", "sand"],
  purple: ["purple", "violet", "plum", "mauve", "magenta"],
};

/** Map a free-text colour to a coarse family, e.g. "Burgundy Metallic" → "red". */
export function colourFamily(colour: string | null): string | null {
  if (!colour) return null;
  const s = colour.trim().toLowerCase();
  if (!s) return null;
  for (const [family, synonyms] of Object.entries(COLOUR_FAMILY_SYNONYMS)) {
    if (synonyms.some((t) => s.includes(t))) return family;
  }
  return s;
}

function normalizedEq(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Cross-model agreement
// ---------------------------------------------------------------------------

function computeAgreement(
  assessment: VisionAssessment,
  verifier: VerifierAssessment,
): { agreement: number; disagreements: string[] } {
  const disagreements: string[] = [];
  let score = 0;

  // make (0.30)
  if (normalizedEq(assessment.vehicle.make, verifier.make)) {
    score += 0.3;
  } else {
    disagreements.push(
      `make: primary=${assessment.vehicle.make ?? "null"}, verifier=${verifier.make ?? "null"}`,
    );
  }

  // model (0.35, abstention earns 0.175 partial credit)
  const primaryModel = assessment.vehicle.model;
  const verifierModel = verifier.model;
  if (primaryModel !== null && verifierModel !== null) {
    if (normalizedEq(primaryModel, verifierModel)) {
      score += 0.35;
    } else {
      disagreements.push(
        `model: primary=${primaryModel}, verifier=${verifierModel}`,
      );
    }
  } else {
    score += 0.175;
  }

  // colour family (0.20)
  const primaryColour = colourFamily(assessment.vehicle.colour);
  const verifierColour = colourFamily(verifier.colour);
  if (primaryColour !== null && verifierColour !== null) {
    if (primaryColour === verifierColour) {
      score += 0.2;
    } else {
      disagreements.push(
        `colour: primary=${assessment.vehicle.colour} (${primaryColour}), verifier=${verifier.colour} (${verifierColour})`,
      );
    }
  } else if (!(primaryColour === null && verifierColour === null)) {
    disagreements.push(
      `colour: primary=${assessment.vehicle.colour ?? "null"}, verifier=${verifier.colour ?? "null"}`,
    );
  }

  // vehicle_class (0.15)
  if (assessment.vehicle.vehicle_class === verifier.vehicle_class) {
    score += 0.15;
  } else {
    disagreements.push(
      `vehicle_class: primary=${assessment.vehicle.vehicle_class}, verifier=${verifier.vehicle_class}`,
    );
  }

  return { agreement: Math.round(score * 1000) / 1000, disagreements };
}

// ---------------------------------------------------------------------------
// Ordered routing rules (extracted so the eval threshold sweep can re-route
// recorded predictions at alternative AUTO_APPROVE floors without re-running
// the vision models)
// ---------------------------------------------------------------------------

/** Every signal the ordered routing rules read. */
export interface RoutingSignals {
  isVehicle: boolean;
  imageQuality: ImageQuality;
  hasAirbagDeployment: boolean;
  hasStructuralIndicators: boolean;
  isTotalLossLikely: boolean;
  hasPreexistingWearOnly: boolean;
  damageItemCount: number;
  overall: number;
  damageScore: number;
  agreement: number | null;
}

export interface RoutingThresholds {
  overall: number;
  damage: number;
  agreement: number;
}

/** Ordered routing rules (plan §8.1, first match wins). */
export function decideRoute(
  signals: RoutingSignals,
  thresholds: RoutingThresholds = ROUTING_THRESHOLDS,
): { route: RouteDecision; reasons: string[] } {
  const reasons: string[] = [];
  const damageScoreRounded = Math.round(signals.damageScore * 10000) / 10000;
  const { agreement } = signals;

  if (!signals.isVehicle) {
    return { route: "REJECT", reasons: ["No vehicle detected in the image."] };
  }
  if (signals.imageQuality === "unusable") {
    return {
      route: "REJECT",
      reasons: ["Image quality is unusable for assessment."],
    };
  }
  if (
    signals.hasAirbagDeployment ||
    signals.hasStructuralIndicators ||
    signals.isTotalLossLikely
  ) {
    const escalateReasons: string[] = [];
    if (signals.hasAirbagDeployment) {
      escalateReasons.push("Airbag deployment requires human review.");
    }
    if (signals.hasStructuralIndicators) {
      escalateReasons.push("Structural damage indicators require human review.");
    }
    if (signals.isTotalLossLikely) {
      escalateReasons.push("Total loss likely — routed to human review.");
    }
    return { route: "ESCALATE", reasons: escalateReasons };
  }
  if (signals.hasPreexistingWearOnly && signals.damageItemCount === 0) {
    return {
      route: "REJECT",
      reasons: ["Pre-existing wear only; no collision damage to assess."],
    };
  }
  if (
    signals.overall < thresholds.overall ||
    signals.damageScore < thresholds.damage ||
    (agreement !== null && agreement < thresholds.agreement)
  ) {
    if (signals.overall < thresholds.overall) {
      reasons.push(
        `Overall confidence ${signals.overall.toFixed(2)} below ${thresholds.overall} threshold.`,
      );
    }
    if (signals.damageScore < thresholds.damage) {
      reasons.push(
        `Damage confidence ${damageScoreRounded.toFixed(2)} below ${thresholds.damage} threshold.`,
      );
    }
    if (agreement !== null && agreement < thresholds.agreement) {
      reasons.push(
        `Cross-model agreement ${agreement.toFixed(2)} below ${thresholds.agreement} threshold.`,
      );
    }
    return { route: "ESCALATE", reasons };
  }
  return {
    route: "AUTO_APPROVE",
    reasons: [
      `All gates passed: overall ${signals.overall.toFixed(2)}, damage ${damageScoreRounded.toFixed(2)}, agreement ${agreement !== null ? agreement.toFixed(2) : "n/a"}.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { assessment } = input;
  const verifier = input.verifier ?? null;

  const { agreement, disagreements } = verifier
    ? computeAgreement(assessment, verifier)
    : { agreement: null, disagreements: [] as string[] };

  // --- Per-domain scores ------------------------------------------------------
  const idBase =
    0.5 * assessment.vehicle.make_confidence +
    0.3 * assessment.vehicle.model_confidence +
    0.2 * assessment.vehicle.colour_confidence;
  const vehicleIdScore =
    idBase * (verifier ? 0.6 + 0.4 * (agreement ?? 0) : 0.9);

  const items = assessment.damage_items;
  const meanConfidence =
    items.length > 0
      ? items.reduce((sum, i) => sum + i.confidence, 0) / items.length
      : 0;
  const qualityFactor = QUALITY_FACTORS[assessment.image_quality];
  const damageScore =
    meanConfidence *
    qualityFactor *
    (assessment.has_preexisting_wear_only ? 0.7 : 1.0) *
    (assessment.is_single_vehicle ? 1.0 : 0.5);

  const hiddenRiskFactor = HIDDEN_RISK_FACTORS[assessment.hidden_damage_risk];
  const costScore =
    damageScore *
    hiddenRiskFactor *
    (assessment.has_airbag_deployment || assessment.has_structural_indicators
      ? 0.75
      : 1.0);

  const overallRaw =
    0.25 * vehicleIdScore + 0.4 * damageScore + 0.35 * costScore;
  const overall = Math.round(Math.min(1, Math.max(0, overallRaw)) * 10000) / 10000;

  const vehicleIdScoreRounded = Math.round(vehicleIdScore * 10000) / 10000;
  const damageScoreRounded = Math.round(damageScore * 10000) / 10000;
  const costScoreRounded = Math.round(costScore * 10000) / 10000;

  // --- Ordered routing rules (first match wins) --------------------------------
  const { route, reasons } = decideRoute({
    isVehicle: assessment.is_vehicle,
    imageQuality: assessment.image_quality,
    hasAirbagDeployment: assessment.has_airbag_deployment,
    hasStructuralIndicators: assessment.has_structural_indicators,
    isTotalLossLikely: input.isTotalLossLikely ?? false,
    hasPreexistingWearOnly: assessment.has_preexisting_wear_only,
    damageItemCount: items.length,
    overall,
    damageScore,
    agreement,
  });

  return {
    agreement,
    disagreements,
    vehicle_id_score: vehicleIdScoreRounded,
    damage_score: damageScoreRounded,
    cost_score: costScoreRounded,
    overall,
    route,
    routing_reasons: reasons,
  };
}
