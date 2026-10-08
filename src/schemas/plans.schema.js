const { z } = require("zod");

// Prijs (in centen) en extra limieten zijn optioneel; null = onbekend/onbeperkt.
const extraLimits = {
  priceMonthlyCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  maxStorageMb: z.number().int().positive().max(10_000_000).nullable().optional(),
  maxScansMonth: z.number().int().positive().max(1_000_000_000).nullable().optional()
};

const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  maxUsers: z.number().int().positive(),
  maxProducts: z.number().int().positive(),
  featureFlags: z.string().max(4000).optional(),
  partnerAssignable: z.boolean().optional(),
  ...extraLimits
});

const updatePlanSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    maxUsers: z.number().int().positive().optional(),
    maxProducts: z.number().int().positive().optional(),
    featureFlags: z.string().max(4000).optional(),
    partnerAssignable: z.boolean().optional(),
    ...extraLimits
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { createPlanSchema, updatePlanSchema };
