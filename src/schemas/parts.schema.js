const { z } = require("zod");

const createPartSchema = z.object({
  partNumber: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  imageUrl: z.string().max(1000).optional()
});

module.exports = { createPartSchema };
