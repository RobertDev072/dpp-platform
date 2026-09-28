const { z } = require("zod");

const emptyToNull = (value) => (typeof value === "string" && value.trim() === "" ? null : value);

const planFields = {
  name: z.string().trim().min(1).max(100),
  description: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()).optional(),
  // Plans.max_users is NOT NULL: een plan heeft altijd een limiet. "Geen limiet" voor één
  // company regel je met Companies.max_users of door geen plan te koppelen.
  maxUsers: z.number().int().min(0).max(1000000),
  maxProducts: z.number().int().min(0).max(10000000),
  isActive: z.boolean().optional()
};

const createPlanSchema = z.object(planFields);

const updatePlanSchema = z
  .object({
    name: planFields.name.optional(),
    description: planFields.description,
    maxUsers: planFields.maxUsers.optional(),
    maxProducts: planFields.maxProducts.optional(),
    isActive: planFields.isActive
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Geen velden om bij te werken" });

module.exports = { createPlanSchema, updatePlanSchema };
