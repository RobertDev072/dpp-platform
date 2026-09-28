const { z } = require("zod");

const createDocumentSchema = z.object({
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  language: z.string().max(10).optional(),
  storageUrl: z.string().min(1).max(1000),
  isPublic: z.boolean().optional().default(false),
  category: z.enum(["document", "manual", "video", "3d_model"]).optional().default("document")
});

module.exports = { createDocumentSchema };
