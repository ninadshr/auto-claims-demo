import { describe, expect, it } from "vitest";

import { computeConfidence } from "@/lib/confidence";
import { computeCostEstimate } from "@/lib/costing";
import {
  ADJACENT_PANELS,
  CLASS_PARTS_MULTIPLIERS,
  PANEL_RATES,
  REGIONAL_RATES,
  SEVERITY_MULTIPLIERS,
} from "@/lib/rate-card";
import {
  PANELS,
  VEHICLE_CLASSES,
  type DamageItem,
  type VerifierAssessment,
  type VisionAssessment,
} from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<DamageItem> = {}): DamageItem {
  return {
    panel: "front_bumper",
    damage_type: "dent with scratching",
    severity: "moderate",
    affected_area_pct: 30,
    recommended_operation: "REPAIR",
    paint_type: "solid",
    confidence: 0.9,
    notes: "",
    ...overrides,
  };
}

function makeAssessment(
  overrides: Partial<VisionAssessment> = {},
): VisionAssessment {
  return {
    is_vehicle: true,
    image_quality: "good",
    image_quality_notes: "",
    is_single_vehicle: true,
    has_preexisting_wear_only: false,
    has_airbag_deployment: false,
    has_structural_indicators: false,
    hidden_damage_risk: "low",
    vehicle: {
      make: "Toyota",
      make_confidence: 0.95,
      model: "Camry",
      model_confidence: 0.9,
      colour: "Silver",
      colour_confidence: 0.95,
      vehicle_class: "sedan",
      class_confidence: 0.9,
    },
    damage_summary: "Front bumper dent with scratching.",
    damage_items: [],
    ...overrides,
  };
}

function makeVerifier(
  overrides: Partial<VerifierAssessment> = {},
): VerifierAssessment {
  return {
    is_vehicle: true,
    make: "Toyota",
    make_confidence: 0.95,
    model: "Camry",
    model_confidence: 0.9,
    colour: "Silver",
    colour_confidence: 0.95,
    vehicle_class: "sedan",
    ...overrides,
  };
}

/** Front bumper REPLACE, sedan, US_NATIONAL, solid paint. */
function frontBumperReplaceAssessment(): VisionAssessment {
  return makeAssessment({
    damage_items: [
      makeItem({ recommended_operation: "REPLACE", severity: "severe" }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Rate-card integrity
// ---------------------------------------------------------------------------

describe("rate card integrity", () => {
  it("has an entry for every one of the 28 panels", () => {
    expect(PANELS).toHaveLength(28);
    for (const panel of PANELS) {
      expect(PANEL_RATES[panel], `missing rate for ${panel}`).toBeDefined();
    }
    expect(Object.keys(PANEL_RATES)).toHaveLength(28);
  });

  it("defines adjacency for every panel, referencing only valid panels", () => {
    for (const panel of PANELS) {
      const adjacent = ADJACENT_PANELS[panel];
      expect(adjacent, `missing adjacency for ${panel}`).toBeDefined();
      for (const neighbor of adjacent) {
        expect(PANELS).toContain(neighbor);
      }
    }
  });

  it("defines multipliers for every vehicle class and severity", () => {
    expect(Object.keys(CLASS_PARTS_MULTIPLIERS).sort()).toEqual(
      [...VEHICLE_CLASSES].sort(),
    );
    for (const mult of Object.values(SEVERITY_MULTIPLIERS)) {
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(2);
    }
  });

  it("orders regional body labor rates SOUTHEAST < MIDWEST < NATIONAL < NORTHEAST < WEST", () => {
    const { US_SOUTHEAST, US_MIDWEST, US_NATIONAL, US_NORTHEAST, US_WEST } =
      REGIONAL_RATES;
    expect(US_SOUTHEAST.body).toBeLessThan(US_MIDWEST.body);
    expect(US_MIDWEST.body).toBeLessThan(US_NATIONAL.body);
    expect(US_NATIONAL.body).toBeLessThan(US_NORTHEAST.body);
    expect(US_NORTHEAST.body).toBeLessThan(US_WEST.body);
  });
});

// ---------------------------------------------------------------------------
// Costing engine — line-item math
// ---------------------------------------------------------------------------

describe("costing engine line-item math", () => {
  it("computes a fully hand-checked estimate for a front bumper REPLACE", () => {
    const estimate = computeCostEstimate({
      assessment: frontBumperReplaceAssessment(),
      region: "US_NATIONAL",
    });

    // Damage line: parts 420, body 1.8h, paint 2.4h, mech 0.5h
    const bumper = estimate.line_items.find((l) => l.panel === "front_bumper");
    expect(bumper).toMatchObject({
      operation: "REPLACE",
      parts_usd: 420,
      body_hrs: 1.8,
      paint_hrs: 2.4,
      mechanical_hrs: 0.5,
      labor_usd: 310.6, // 1.8*68 + 2.4*58 + 0.5*98
      materials_usd: 100.8, // 2.4*42
      line_total_usd: 831.4,
    });

    // Auto-injected blends on both adjacent fenders: 0.5 * 2.0 = 1.0 paint hr
    const blends = estimate.line_items.filter((l) => l.operation === "BLEND");
    expect(blends.map((l) => l.panel).sort()).toEqual([
      "front_left_fender",
      "front_right_fender",
    ]);
    for (const blend of blends) {
      expect(blend).toMatchObject({
        parts_usd: 0,
        paint_hrs: 1.0,
        labor_usd: 58,
        materials_usd: 42,
        line_total_usd: 100,
      });
      expect(blend.description).toContain("Colour-match blend");
    }

    expect(estimate.totals).toEqual({
      parts_usd: 420,
      labor_usd: 426.6, // 310.60 + 2 * 58
      materials_usd: 184.8, // 100.80 + 2 * 42
      pre_post_scan_usd: 125, // REPLACE present
      shop_supplies_usd: 17.06, // min(35, 4% of 426.60)
      hazmat_usd: 8.53, // 2% of labor (paint hrs > 0)
      tax_usd: 42.34, // 7% of (420 + 184.80)
      point_usd: 1224.33,
    });

    // Base ±15% band, no widening factors
    expect(estimate.uncertainty).toMatchObject({
      band: 0.15,
      low_usd: 1040.68,
      point_usd: 1224.33,
      high_usd: 1407.98,
    });
    expect(estimate.rate_card_version).toBe("2026.11-demo");
    expect(estimate.currency).toBe("USD");
    expect(estimate.disclaimer).toContain("illustrative");
  });

  it("scales REPAIR body hours by severity multiplier and area factor", () => {
    const cases: Array<{
      severity: DamageItem["severity"];
      area: number;
      expectedHrs: number;
    }> = [
      { severity: "moderate", area: 30, expectedHrs: 3.0 }, // 3.0 * 1.00 * 1.00
      { severity: "minor", area: 10, expectedHrs: 1.27 }, // 3.0 * 0.65 * 0.65
      { severity: "severe", area: 60, expectedHrs: 5.76 }, // 3.0 * 1.60 * 1.20
      { severity: "cosmetic", area: 90, expectedHrs: 1.42 }, // 3.0 * 0.35 * 1.35
    ];
    for (const { severity, area, expectedHrs } of cases) {
      const estimate = computeCostEstimate({
        assessment: makeAssessment({
          damage_items: [
            makeItem({
              panel: "hood",
              severity,
              affected_area_pct: area,
              recommended_operation: "REPAIR",
            }),
          ],
        }),
      });
      const hood = estimate.line_items.find((l) => l.panel === "hood");
      expect(hood?.body_hrs, `${severity} @ ${area}%`).toBeCloseTo(
        expectedHrs,
        2,
      );
      expect(hood?.parts_usd).toBe(0); // REPAIR has no parts
    }
  });

  it("multiplies paint hours by 1.25 for multi-stage paint", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({
            panel: "hood",
            recommended_operation: "REPAIR",
            paint_type: "multi_stage",
          }),
        ],
      }),
    });
    expect(
      estimate.line_items.find((l) => l.panel === "hood")?.paint_hrs,
    ).toBe(3.5); // 2.8 * 1.25
  });

  it("charges a flat 0.5 body hours for INSPECT with no parts or paint", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({ panel: "headlamp_left", recommended_operation: "INSPECT" }),
        ],
      }),
    });
    const lamp = estimate.line_items.find((l) => l.panel === "headlamp_left");
    expect(lamp).toMatchObject({
      operation: "INSPECT",
      body_hrs: 0.5,
      paint_hrs: 0,
      parts_usd: 0,
      labor_usd: 34, // 0.5 * 68
      materials_usd: 0,
    });
    // No REPLACE anywhere and no structural flags → no scan fee, no hazmat
    expect(estimate.totals.pre_post_scan_usd).toBe(0);
    expect(estimate.totals.hazmat_usd).toBe(0);
    expect(estimate.totals.tax_usd).toBe(0);
  });

  it("applies vehicle-class parts multipliers to parts only", () => {
    const item = makeItem({
      panel: "headlamp_left",
      recommended_operation: "REPLACE",
    });
    const luxury = computeCostEstimate({
      assessment: makeAssessment({
        vehicle: { ...makeAssessment().vehicle, vehicle_class: "luxury" },
        damage_items: [item],
      }),
    });
    const economy = computeCostEstimate({
      assessment: makeAssessment({
        vehicle: { ...makeAssessment().vehicle, vehicle_class: "economy" },
        damage_items: [item],
      }),
    });
    expect(luxury.line_items[0]?.parts_usd).toBe(990); // 450 * 2.20
    expect(economy.line_items[0]?.parts_usd).toBe(360); // 450 * 0.80
    // Labor identical across classes
    expect(luxury.line_items[0]?.labor_usd).toBe(
      economy.line_items[0]?.labor_usd,
    );
  });
});

// ---------------------------------------------------------------------------
// Costing engine — operations, dedup, blends
// ---------------------------------------------------------------------------

describe("operation resolution, dedup, and blend injection", () => {
  it("forces REPLACE when severity is destroyed", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({ severity: "destroyed", recommended_operation: "REPAIR" }),
        ],
      }),
    });
    const line = estimate.line_items.find((l) => l.panel === "front_bumper");
    expect(line?.operation).toBe("REPLACE");
    expect(line?.parts_usd).toBe(420);
    expect(estimate.notes.join(" ")).toContain("forces REPLACE");
  });

  it("requires seam inspection when replacing a weldable structural panel", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({
            panel: "rear_left_quarter",
            recommended_operation: "REPLACE",
          }),
        ],
      }),
    });
    expect(estimate.notes.join(" ")).toContain("seam inspection");
  });

  it("deduplicates repeated panels, keeping the highest severity", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({ severity: "minor", recommended_operation: "REPAIR" }),
          makeItem({ severity: "moderate", recommended_operation: "REPAIR" }),
        ],
      }),
    });
    const bumperLines = estimate.line_items.filter(
      (l) => l.panel === "front_bumper" && l.operation !== "BLEND",
    );
    expect(bumperLines).toHaveLength(1);
    expect(bumperLines[0]?.body_hrs).toBe(2.5); // moderate: 2.5 * 1.00 * 1.00
    expect(estimate.warnings.join(" ")).toContain("Duplicate panel");
  });

  it("never blends a panel that is already in the estimate", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({ recommended_operation: "REPLACE", severity: "severe" }),
          makeItem({
            panel: "front_left_fender",
            recommended_operation: "REPAIR",
          }),
        ],
      }),
    });
    const blendPanels = estimate.line_items
      .filter((l) => l.operation === "BLEND")
      .map((l) => l.panel)
      .sort();
    // bumper blends front_right_fender (left fender is in the estimate);
    // left fender blends hood and front_left_door (bumper is in the estimate)
    expect(blendPanels).toEqual([
      "front_left_door",
      "front_right_fender",
      "hood",
    ]);
    // Each blend panel appears exactly once (no cascade, no duplicates)
    const blendCounts = new Set(
      estimate.line_items
        .filter((l) => l.operation === "BLEND")
        .map((l) => l.panel),
    );
    expect(blendCounts.size).toBe(blendPanels.length);
  });

  it("adds no blend lines for non-blendable panels", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({
            panel: "headlamp_left",
            recommended_operation: "REPLACE",
          }),
          makeItem({
            panel: "windshield",
            recommended_operation: "REPLACE",
          }),
        ],
      }),
    });
    expect(
      estimate.line_items.filter((l) => l.operation === "BLEND"),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Costing engine — fees, tax, regions
// ---------------------------------------------------------------------------

describe("fees, tax, and regional variation", () => {
  it("charges scan fee and tax but no hazmat for a paint-free REPLACE", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({
            panel: "headlamp_left",
            recommended_operation: "REPLACE",
          }),
        ],
      }),
    });
    expect(estimate.totals).toMatchObject({
      pre_post_scan_usd: 125, // REPLACE present
      hazmat_usd: 0, // no paint hours
      shop_supplies_usd: 4.14, // 4% of 103.40 labor
      tax_usd: 31.5, // 7% of 450 parts
      point_usd: 714.04,
    });
  });

  it("charges the scan fee on structural indicators even with no REPLACE", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        has_structural_indicators: true,
        damage_items: [
          makeItem({ panel: "hood", recommended_operation: "REPAIR" }),
        ],
      }),
    });
    expect(estimate.totals.pre_post_scan_usd).toBe(125);
  });

  it("caps shop supplies at $35 for high-labor estimates", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({ panel: "roof", recommended_operation: "REPLACE" }),
        ],
      }),
    });
    expect(estimate.totals.labor_usd).toBeGreaterThan(875); // 4% would exceed $35
    expect(estimate.totals.shop_supplies_usd).toBe(35);
  });

  it("orders point estimates across regions by labor cost", () => {
    const points = (["US_SOUTHEAST", "US_MIDWEST", "US_NATIONAL", "US_NORTHEAST", "US_WEST"] as const).map(
      (region) =>
        computeCostEstimate({
          assessment: frontBumperReplaceAssessment(),
          region,
        }).totals.point_usd,
    );
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(points[0]).toBeLessThan(points[points.length - 1]);
  });

  it("produces identical output for identical input (determinism)", () => {
    const assessment = frontBumperReplaceAssessment();
    const a = computeCostEstimate({ assessment, region: "US_WEST", acvUsd: 4000 });
    const b = computeCostEstimate({ assessment, region: "US_WEST", acvUsd: 4000 });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Uncertainty bands & total loss
// ---------------------------------------------------------------------------

describe("uncertainty bands", () => {
  it("widens for hidden risk, structural flags, and poor image quality, clamped at 60%", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        image_quality: "poor",
        has_structural_indicators: true,
        hidden_damage_risk: "high",
        damage_items: [
          makeItem({ panel: "hood", recommended_operation: "REPAIR" }),
        ],
      }),
    });
    // 0.15 + 0.22 + 0.25 + 0.15 = 0.77 → clamped to 0.60
    expect(estimate.uncertainty.band).toBe(0.6);
    const reasons = estimate.uncertainty.reasons.join(" ");
    expect(reasons).toContain("hidden-damage");
    expect(reasons).toContain("Structural");
    expect(reasons).toContain("image quality");
    expect(reasons).toContain("clamped");
  });

  it("narrows for a single cosmetic item, clamped at the 12% floor", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({
        damage_items: [
          makeItem({ severity: "cosmetic", recommended_operation: "REPAIR" }),
        ],
      }),
    });
    // 0.15 - 0.05 = 0.10 → clamped to 0.12
    expect(estimate.uncertainty.band).toBe(0.12);
    expect(estimate.uncertainty.reasons.join(" ")).toContain("cosmetic");
  });

  it("keeps the point estimate inside the band", () => {
    const estimate = computeCostEstimate({
      assessment: frontBumperReplaceAssessment(),
    });
    const { low_usd, point_usd, high_usd } = estimate.uncertainty;
    expect(low_usd).toBeLessThan(point_usd);
    expect(point_usd).toBeLessThan(high_usd);
    expect(point_usd).toBe(estimate.totals.point_usd);
  });
});

describe("total-loss triggers", () => {
  it("flags total loss when the point estimate reaches 75% of ACV", () => {
    const estimate = computeCostEstimate({
      assessment: frontBumperReplaceAssessment(), // point = 1224.33
      acvUsd: 1500, // 75% = 1125 ≤ 1224.33
    });
    expect(estimate.is_total_loss_likely).toBe(true);
    expect(estimate.total_loss_reasons.join(" ")).toContain("75% of ACV");
  });

  it("does not flag total loss below the 75% threshold", () => {
    const estimate = computeCostEstimate({
      assessment: frontBumperReplaceAssessment(),
      acvUsd: 5000, // 75% = 3750 > 1224.33
    });
    expect(estimate.is_total_loss_likely).toBe(false);
    expect(estimate.total_loss_reasons).toHaveLength(0);
  });

  it("flags total loss on airbag deployment regardless of ACV", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment({ has_airbag_deployment: true }),
    });
    expect(estimate.is_total_loss_likely).toBe(true);
    expect(estimate.total_loss_reasons.join(" ")).toContain("Airbag");
  });

  it("returns a zero-cost estimate for a damage-free assessment", () => {
    const estimate = computeCostEstimate({
      assessment: makeAssessment(), // no damage items, no flags
    });
    expect(estimate.line_items).toHaveLength(0);
    expect(estimate.totals.point_usd).toBe(0);
    expect(estimate.uncertainty).toMatchObject({
      low_usd: 0,
      high_usd: 0,
    });
    expect(estimate.is_total_loss_likely).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confidence scoring & STP routing
// ---------------------------------------------------------------------------

describe("cross-model agreement", () => {
  it("scores a perfect match as 1.0 with no disagreements", () => {
    const result = computeConfidence({
      assessment: makeAssessment({ damage_items: [makeItem()] }),
      verifier: makeVerifier(),
    });
    expect(result.agreement).toBe(1);
    expect(result.disagreements).toHaveLength(0);
  });

  it("records explicit disagreement strings for the vehicle-ID stress case", () => {
    const result = computeConfidence({
      assessment: makeAssessment({
        vehicle: {
          make: "Citroën",
          make_confidence: 0.9,
          model: "Xsara",
          model_confidence: 0.85,
          colour: "Red",
          colour_confidence: 0.9,
          vehicle_class: "sedan",
          class_confidence: 0.85,
        },
        damage_items: [makeItem()],
      }),
      verifier: makeVerifier({
        make: "Chrysler",
        model: "Sebring",
        colour: "Red",
        vehicle_class: "sedan",
      }),
    });
    // make mismatch (0) + model mismatch (0) + colour match (0.20) + class match (0.15)
    expect(result.agreement).toBe(0.35);
    expect(result.disagreements.join(" ")).toContain("make: primary=Citroën");
    expect(result.disagreements.join(" ")).toContain("model: primary=Xsara");
  });

  it("awards 0.175 partial credit when either model abstains", () => {
    const result = computeConfidence({
      assessment: makeAssessment({
        vehicle: {
          ...makeAssessment().vehicle,
          model: null,
          model_confidence: 0.35,
        },
        damage_items: [makeItem()],
      }),
      verifier: makeVerifier({ model: "Camry" }),
    });
    // make 0.30 + model abstention 0.175 + colour 0.20 + class 0.15
    expect(result.agreement).toBe(0.825);
  });

  it("matches colours by family, not exact string", () => {
    const result = computeConfidence({
      assessment: makeAssessment({
        vehicle: {
          ...makeAssessment().vehicle,
          colour: "Light Evergreen Metallic",
        },
        damage_items: [makeItem()],
      }),
      verifier: makeVerifier({ colour: "Green" }),
    });
    expect(result.agreement).toBe(1); // all four fields agree at family level
  });
});

describe("composite scores and routing", () => {
  const strongAssessment = makeAssessment({ damage_items: [makeItem()] });

  it("routes a high-confidence, verified claim to AUTO_APPROVE", () => {
    const result = computeConfidence({
      assessment: strongAssessment,
      verifier: makeVerifier(),
    });
    expect(result.vehicle_id_score).toBeCloseTo(0.935, 3);
    expect(result.damage_score).toBeCloseTo(0.9, 3);
    expect(result.cost_score).toBeCloseTo(0.9, 3);
    expect(result.overall).toBeCloseTo(0.9088, 3);
    expect(result.route).toBe("AUTO_APPROVE");
  });

  it("caps vehicle-ID confidence at 0.9 when no verifier ran", () => {
    const result = computeConfidence({ assessment: strongAssessment });
    expect(result.agreement).toBeNull();
    expect(result.vehicle_id_score).toBeCloseTo(0.935 * 0.9, 3);
    expect(result.route).toBe("AUTO_APPROVE");
  });

  it("REJECTs non-vehicle images and unusable photos (rules 1)", () => {
    expect(
      computeConfidence({ assessment: makeAssessment({ is_vehicle: false }) })
        .route,
    ).toBe("REJECT");
    expect(
      computeConfidence({
        assessment: makeAssessment({ image_quality: "unusable" }),
      }).route,
    ).toBe("REJECT");
  });

  it("ESCALATEs safety and total-loss flags before confidence rules (rule 2)", () => {
    const result = computeConfidence({
      assessment: makeAssessment({
        has_airbag_deployment: true,
        has_structural_indicators: true,
        damage_items: [makeItem()],
      }),
      verifier: makeVerifier(),
      isTotalLossLikely: true,
    });
    expect(result.route).toBe("ESCALATE");
    // First-match-wins: safety reasons present, no threshold reasons
    const reasons = result.routing_reasons.join(" ");
    expect(reasons).toContain("Airbag");
    expect(reasons).toContain("Structural");
    expect(reasons).toContain("Total loss");
    expect(reasons).not.toContain("below");
  });

  it("REJECTs pre-existing-wear-only claims with no damage items (rule 3)", () => {
    const result = computeConfidence({
      assessment: makeAssessment({ has_preexisting_wear_only: true }),
    });
    expect(result.route).toBe("REJECT");
    expect(result.routing_reasons.join(" ")).toContain("Pre-existing wear");
  });

  it("ESCALATEs when cross-model agreement falls below 0.60 (rule 4)", () => {
    const result = computeConfidence({
      assessment: makeAssessment({
        vehicle: {
          make: "Citroën",
          make_confidence: 0.9,
          model: "Xsara",
          model_confidence: 0.85,
          colour: "Red",
          colour_confidence: 0.9,
          vehicle_class: "sedan",
          class_confidence: 0.85,
        },
        damage_items: [makeItem()],
      }),
      verifier: makeVerifier({
        make: "Chrysler",
        model: "Sebring",
        colour: "Red",
        vehicle_class: "unknown",
      }),
    });
    // agreement 0.20 (colour family only) < 0.60 → ESCALATE
    expect(result.agreement).toBe(0.2);
    expect(result.route).toBe("ESCALATE");
    expect(result.routing_reasons.join(" ")).toContain("agreement 0.20");
  });

  it("ESCALATEs on low per-item damage confidence (rule 4)", () => {
    const result = computeConfidence({
      assessment: makeAssessment({
        damage_items: [makeItem({ confidence: 0.6 })],
      }),
      verifier: makeVerifier(),
    });
    expect(result.damage_score).toBeCloseTo(0.6, 3);
    expect(result.route).toBe("ESCALATE");
    expect(result.routing_reasons.join(" ")).toContain("Damage confidence");
  });

  it("halves damage confidence when multiple vehicles share the frame", () => {
    const single = computeConfidence({
      assessment: strongAssessment,
      verifier: makeVerifier(),
    });
    const multi = computeConfidence({
      assessment: makeAssessment({
        is_single_vehicle: false,
        damage_items: [makeItem()],
      }),
      verifier: makeVerifier(),
    });
    expect(multi.damage_score).toBeCloseTo(single.damage_score / 2, 3);
    expect(multi.route).toBe("ESCALATE");
  });

  it("still AUTO_APPROVEs a make-only disagreement when all gates pass", () => {
    const result = computeConfidence({
      assessment: strongAssessment,
      verifier: makeVerifier({ make: "Honda" }),
    });
    // agreement 0.70 (make wrong, rest right) ≥ 0.60; confidence high
    expect(result.agreement).toBe(0.7);
    expect(result.route).toBe("AUTO_APPROVE");
  });

  it("penalizes cost confidence for hidden risk and safety flags", () => {
    const base = computeConfidence({
      assessment: strongAssessment,
      verifier: makeVerifier(),
    });
    const risky = computeConfidence({
      assessment: makeAssessment({
        hidden_damage_risk: "high",
        has_structural_indicators: true,
        damage_items: [makeItem()],
      }),
    });
    // 0.9 * 0.75 (high risk) * 0.75 (structural) = 0.50625
    expect(risky.cost_score).toBeCloseTo(0.5063, 3);
    expect(risky.cost_score).toBeLessThan(base.cost_score);
    expect(risky.route).toBe("ESCALATE"); // structural flag fires rule 2
  });
});
