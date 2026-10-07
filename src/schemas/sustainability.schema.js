const { z } = require("zod");

const materialSchema = z.object({
  material: z.string().min(1).max(100),
  pct: z.number().min(0).max(100).nullable().optional()
});

const updateSustainabilitySchema = z.object({
  // null = veld wissen; weglaten = ongewijzigd laten.
  co2FootprintKg: z.number().min(0).nullable().optional(),
  co2ReductionPct: z.number().min(0).max(100).nullable().optional(),
  recycledMaterialPct: z.number().min(0).max(100).nullable().optional(),
  materials: z.array(materialSchema).max(20).nullable().optional(),
  epdUrl: z.string().max(1000).nullable().optional(),
  recyclable: z.boolean().nullable().optional(),
  reachConform: z.boolean().nullable().optional(),
  rohsConform: z.boolean().nullable().optional(),
  expectedLifespanYears: z.number().int().positive().nullable().optional()
});

module.exports = { updateSustainabilitySchema };
