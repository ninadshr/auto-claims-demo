import { z } from "zod";

/**
 * Single source of truth for all structured data exchanged with vision models.
 * The VLM NEVER outputs dollar amounts — only physical facts from these enums.
 */

// ---------------------------------------------------------------------------
// Closed enums
// ---------------------------------------------------------------------------

/** 28 standard body-shop panels. Left/right = driver's perspective. */
export const PANELS = [
  "front_bumper",
  "rear_bumper",
  "hood",
  "trunk_lid",
  "roof",
  "grille",
  "front_left_fender",
  "front_right_fender",
  "rear_left_quarter",
  "rear_right_quarter",
  "front_left_door",
  "front_right_door",
  "rear_left_door",
  "rear_right_door",
  "headlamp_left",
  "headlamp_right",
  "taillamp_left",
  "taillamp_right",
  "windshield",
  "rear_glass",
  "mirror_left",
  "mirror_right",
  "wheel_front_left",
  "wheel_front_right",
  "wheel_rear_left",
  "wheel_rear_right",
  "rocker_panel_left",
  "rocker_panel_right",
] as const;

export const PanelSchema = z.enum(PANELS);
export type Panel = (typeof PANELS)[number];

export const SEVERITIES = [
  "cosmetic",
  "minor",
  "moderate",
  "severe",
  "destroyed",
] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = (typeof SEVERITIES)[number];

/** `BLEND` is NEVER emitted by the VLM — costing.ts injects blend lines. */
export const OPERATIONS = ["REPAIR", "REPLACE", "INSPECT"] as const;
export const OperationSchema = z.enum(OPERATIONS);
export type Operation = (typeof OPERATIONS)[number];

export const VEHICLE_CLASSES = [
  "economy",
  "sedan",
  "suv",
  "luxury",
  "truck",
  "unknown",
] as const;
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES);
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const IMAGE_QUALITIES = ["good", "acceptable", "poor", "unusable"] as const;
export const ImageQualitySchema = z.enum(IMAGE_QUALITIES);
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const ROUTE_DECISIONS = ["AUTO_APPROVE", "ESCALATE", "REJECT"] as const;
export const RouteDecisionSchema = z.enum(ROUTE_DECISIONS);
export type RouteDecision = (typeof ROUTE_DECISIONS)[number];

export const HIDDEN_DAMAGE_RISKS = ["low", "medium", "high"] as const;
export const HiddenDamageRiskSchema = z.enum(HIDDEN_DAMAGE_RISKS);
export type HiddenDamageRisk = (typeof HIDDEN_DAMAGE_RISKS)[number];

export const PAINT_TYPES = ["solid", "multi_stage"] as const;
export const PaintTypeSchema = z.enum(PAINT_TYPES);
export type PaintType = (typeof PAINT_TYPES)[number];

// ---------------------------------------------------------------------------
// Assessment schemas
// ---------------------------------------------------------------------------

export const VehicleInfoSchema = z.object({
  make: z.string().nullable(),
  make_confidence: z.number().min(0).max(1),
  model: z.string().nullable(),
  model_confidence: z.number().min(0).max(1),
  colour: z.string().nullable(),
  colour_confidence: z.number().min(0).max(1),
  vehicle_class: VehicleClassSchema,
  class_confidence: z.number().min(0).max(1),
});
export type VehicleInfo = z.infer<typeof VehicleInfoSchema>;

export const DamageItemSchema = z.object({
  panel: PanelSchema,
  damage_type: z.string(),
  severity: SeveritySchema,
  affected_area_pct: z.number().min(0).max(100),
  recommended_operation: OperationSchema,
  paint_type: PaintTypeSchema,
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});
export type DamageItem = z.infer<typeof DamageItemSchema>;

/** Primary VLM output. STRICTLY no dollar fields. */
export const VisionAssessmentSchema = z.object({
  is_vehicle: z.boolean(),
  image_quality: ImageQualitySchema,
  image_quality_notes: z.string(),
  is_single_vehicle: z.boolean(),
  has_preexisting_wear_only: z.boolean(),
  has_airbag_deployment: z.boolean(),
  has_structural_indicators: z.boolean(),
  hidden_damage_risk: HiddenDamageRiskSchema,
  vehicle: VehicleInfoSchema,
  damage_summary: z.string(),
  damage_items: z.array(DamageItemSchema),
});
export type VisionAssessment = z.infer<typeof VisionAssessmentSchema>;

/** Slim vehicle-ID schema for the cross-model verifier. */
export const VerifierAssessmentSchema = z.object({
  is_vehicle: z.boolean(),
  make: z.string().nullable(),
  make_confidence: z.number().min(0).max(1),
  model: z.string().nullable(),
  model_confidence: z.number().min(0).max(1),
  colour: z.string().nullable(),
  colour_confidence: z.number().min(0).max(1),
  vehicle_class: VehicleClassSchema,
});
export type VerifierAssessment = z.infer<typeof VerifierAssessmentSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export (for provider `response_format: json_schema`)
// ---------------------------------------------------------------------------

/**
 * Convert a zod schema to a strict-mode JSON Schema suitable for provider
 * `response_format: json_schema` (Fireworks / OpenAI strict mode): strips the
 * `$schema` decorator key and defensively enforces full `required` lists +
 * `additionalProperties: false` on every object node.
 */
export function strictJsonSchema<T extends z.ZodType>(
  schema: T,
): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  delete json.$schema;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (obj.type === "object" && obj.properties) {
        obj.additionalProperties = false;
        if (!Array.isArray(obj.required)) {
          obj.required = Object.keys(obj.properties);
        }
      }
      Object.values(obj).forEach(walk);
    }
  };
  walk(json);
  return json;
}

/** Strict JSON Schema for the primary VLM, used by Fireworks json_schema mode. */
export function visionAssessmentJsonSchema(): Record<string, unknown> {
  return strictJsonSchema(VisionAssessmentSchema);
}

/** Strict JSON Schema for the slim verifier prompt. */
export function verifierAssessmentJsonSchema(): Record<string, unknown> {
  return strictJsonSchema(VerifierAssessmentSchema);
}
