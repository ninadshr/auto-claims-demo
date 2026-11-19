import { describe, expect, it } from "vitest";
import goldenSetJson from "../src/eval/golden-set.json";
import {
  GoldenRowSchema,
  baselineMetrics,
  isFullyCorrect,
  isMakeCorrect,
  panelF1,
  routeAtThreshold,
  severityOrdinalAccuracy,
  sweepThresholds,
  type GoldenRow,
} from "../src/eval/metrics";
import { ROUTING_THRESHOLDS } from "../src/lib/confidence";

const rows = GoldenRowSchema.array().parse(goldenSetJson.rows);
const byId = (id: string): GoldenRow =>
  rows.find((r) => r.id === id) as GoldenRow;

const round = (n: number, digits = 4): number =>
  Math.round(n * 10 ** digits) / 10 ** digits;

describe("golden set contract", () => {
  it("has 6 rows: 4 live samples + 2 simulated edge cases", () => {
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.simulated)).toHaveLength(2);
    expect(rows.filter((r) => !r.simulated && r.image)).toHaveLength(4);
  });

  it("covers all three routes in expected_route", () => {
    const routes = new Set(rows.map((r) => r.expected_route));
    expect(routes).toEqual(new Set(["AUTO_APPROVE", "ESCALATE", "REJECT"]));
  });
});

describe("field-level correctness", () => {
  it("marks the accident row's abstained make as safe but not make-correct", () => {
    const accident = byId("accident_damaged_car");
    expect(accident.prediction.make).toBeNull();
    expect(isMakeCorrect(accident)).toBe(false);
    // Abstention + ESCALATE route keeps the claim safe (no confident-and-wrong).
    expect(routeAtThreshold(accident, 0.5)).toBe("ESCALATE");
  });

  it("treats an exact panel-set match as fully correct (fender simulation)", () => {
    expect(isFullyCorrect(byId("minor_fender_dent_simulated"))).toBe(true);
  });

  it("treats missed panels as not fully correct (citroen hood/fender/headlamp missed)", () => {
    const citroen = byId("citroen_missing_front_bumper");
    expect(isFullyCorrect(citroen)).toBe(false);
  });
});

describe("panel F1 (micro)", () => {
  it("computes the recorded baseline on the seeded golden set", () => {
    const f1 = panelF1(rows);
    // TP=10, FP=0, FN=4 → precision 1.0, recall 10/14, F1 0.8333.
    expect(f1.tp).toBe(10);
    expect(f1.fp).toBe(0);
    expect(f1.fn).toBe(4);
    expect(f1.precision).toBe(1);
    expect(round(f1.recall)).toBe(0.7143);
    expect(round(f1.f1)).toBe(0.8333);
  });

  it("counts false positives", () => {
    const row = byId("clean_car");
    const withHallucination: GoldenRow = {
      ...row,
      prediction: {
        ...row.prediction,
        damage_items: [
          { panel: "hood", severity: "minor", operation: "REPAIR" },
        ],
      },
    };
    const f1 = panelF1([withHallucination]);
    expect(f1.fp).toBe(1);
    expect(f1.precision).toBe(0);
  });
});

describe("severity ordinal accuracy", () => {
  it("is within ±1 tier on every matched panel of the seeded set", () => {
    // citroen grille: ground truth severe vs predicted destroyed (±1).
    expect(severityOrdinalAccuracy(rows)).toBe(1);
  });
});

describe("routeAtThreshold — ordered routing rules at alternative floors", () => {
  it("REJECTs the non-vehicle guardrail at every threshold (rule 1 wins)", () => {
    for (const t of [0.5, 0.72, 0.95]) {
      expect(routeAtThreshold(byId("non_vehicle_guardrail_simulated"), t)).toBe("REJECT");
    }
  });

  it("REJECTs pre-existing wear at every threshold (rule 3 wins)", () => {
    expect(routeAtThreshold(byId("clean_car"), 0.5)).toBe("REJECT");
    expect(routeAtThreshold(byId("clean_car"), 0.95)).toBe("REJECT");
  });

  it("ESCALATEs structural damage at every threshold (rule 2 wins)", () => {
    expect(routeAtThreshold(byId("accident_damaged_car"), 0.5)).toBe("ESCALATE");
    expect(routeAtThreshold(byId("accident_damaged_car"), 0.95)).toBe("ESCALATE");
  });

  it("ESCALATEs the broken bumper at every threshold (fixed agreement gate 0.60)", () => {
    const broken = byId("broken_front_bumper");
    expect(broken.prediction.agreement).toBeLessThan(ROUTING_THRESHOLDS.agreement);
    expect(routeAtThreshold(broken, 0.5)).toBe("ESCALATE");
    expect(routeAtThreshold(broken, 0.95)).toBe("ESCALATE");
  });

  it("auto-approves the simulated fender dent until the floor passes its overall score", () => {
    const fender = byId("minor_fender_dent_simulated");
    expect(routeAtThreshold(fender, ROUTING_THRESHOLDS.overall)).toBe("AUTO_APPROVE");
    expect(routeAtThreshold(fender, 0.85)).toBe("AUTO_APPROVE");
    expect(routeAtThreshold(fender, 0.9)).toBe("ESCALATE");
  });

  it("lets the citroen leak through at loose floors but not at the default", () => {
    const citroen = byId("citroen_missing_front_bumper");
    expect(routeAtThreshold(citroen, 0.5)).toBe("AUTO_APPROVE");
    expect(routeAtThreshold(citroen, ROUTING_THRESHOLDS.overall)).toBe("ESCALATE");
  });
});

describe("threshold sweep", () => {
  const sweep = sweepThresholds(rows);

  it("sweeps 0.50 to 0.95 in 0.05 steps", () => {
    expect(sweep.map((p) => p.threshold)).toEqual([
      0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
    ]);
  });

  it("trades STP for safety monotonically (error rate never rises as STP falls)", () => {
    for (let i = 1; i < sweep.length; i++) {
      expect(sweep[i].stp_rate).toBeLessThanOrEqual(sweep[i - 1].stp_rate);
      expect(sweep[i].error_rate).toBeLessThanOrEqual(sweep[i - 1].error_rate);
    }
  });

  it("matches the recorded trade-off: 33% STP / 17% leak at 0.50, 17% STP / 0 leak at the default floor", () => {
    expect(round(sweep[0].stp_rate)).toBe(0.3333);
    expect(round(sweep[0].error_rate)).toBe(0.1667);
    // The 0.05-step grid brackets the 0.72 default with 0.70; the citroen
    // (overall 0.68) is already held back there, so the default floor's
    // behavior equals the 0.70 grid point.
    const atDefault = sweep.find((p) => p.threshold === 0.7) as (typeof sweep)[number];
    expect(round(atDefault.stp_rate)).toBe(0.1667);
    expect(atDefault.error_rate).toBe(0);
    expect(sweep[9].stp_rate).toBe(0);
  });
});

describe("baseline metrics", () => {
  it("reports the seeded baseline", () => {
    const m = baselineMetrics(rows);
    expect(m.sample_count).toBe(6);
    expect(m.threshold).toBe(ROUTING_THRESHOLDS.overall);
    expect(round(m.panel_f1.f1)).toBe(0.8333);
    expect(m.colour_family_accuracy).toBe(1);
    expect(m.make_accuracy).toBe(0.8);
    expect(m.severity_ordinal_accuracy).toBe(1);
    expect(m.safe_pass_rate).toBe(1);
    expect(m.confident_and_wrong_rate).toBe(0);
    expect(round(m.stp_rate)).toBe(0.1667);
  });
});
