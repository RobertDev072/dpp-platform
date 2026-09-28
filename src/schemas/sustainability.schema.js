const { z } = require("zod");

const materialSchema = z.object({
  material: z.string().min(1).max(100),
  pct: z.number()
});

const updateSustainabilitySchema = z.object({
  co2FootprintKg: z.number().optional(),
  co2ReductionPct: z.number().optional(),
  recycledMaterialPct: z.number().optional(),
  materials: z.array(materialSchema).optional(),
  epdUrl: z.string().max(1000).optional(),
  recyclable: z.boolean().optional(),
  reachConform: z.boolean().optional(),
  rohsConform: z.boolean().optional(),
  expectedLifespanYears: z.number().int().positive().optional()
});

module.exports = { updateSustainabilitySchema };
