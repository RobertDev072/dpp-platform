const { z } = require("zod");

const createBatchSchema = z.object({
  batchNumber: z.string().min(1).max(100),
  productionDate: z.string().date().optional(),
  quantity: z.number().int().positive().optional()
});

module.exports = { createBatchSchema };
