const { z } = require("zod");

const listProductsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  category: z.string().max(100).optional(),
  doc: z.enum(["compleet", "incompleet"]).optional(),
  sort: z.enum(["name", "created_at", "status", "category"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.coerce.number().int().positive().optional()
});

module.exports = { listProductsQuerySchema };
