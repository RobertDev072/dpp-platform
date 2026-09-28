const { z } = require("zod");

const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  maxUsers: z.number().int().positive(),
  maxProducts: z.number().int().positive(),
  featureFlags: z.string().max(4000).optional()
});

const updatePlanSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    maxUsers: z.number().int().positive().optional(),
    maxProducts: z.number().int().positive().optional(),
    featureFlags: z.string().max(4000).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { createPlanSchema, updatePlanSchema };
