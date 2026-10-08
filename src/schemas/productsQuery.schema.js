const { z } = require("zod");

const PRODUCT_FILTER_FIELDS = {
  q: z.string().max(200).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  category: z.string().max(100).optional(),
  doc: z.enum(["compleet", "incompleet"]).optional(),
  missing: z
    .enum(["photo", "description", "category", "identification", "sustainability", "compliance", "documents"])
    .optional(),
  qr: z.enum(["active", "reserved", "none", "any"]).optional()
};

const listProductsQuerySchema = z.object({
  ...PRODUCT_FILTER_FIELDS,
  withScans: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => Boolean(value)),
  sort: z.enum(["name", "created_at", "updated_at", "status", "category"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.coerce.number().int().positive().optional()
});

// Selectie voor bulkacties: óf expliciete id's (geselecteerde rijen), óf een filter
// ("alle 1.248 resultaten"). De server bepaalt het bedrijf; een companyId in de
// selectie bestaat bewust niet.
const productSelectionSchema = z.union([
  z.object({ ids: z.array(z.number().int().positive()).min(1).max(10000) }),
  z.object({ filter: z.object(PRODUCT_FILTER_FIELDS) })
]);

module.exports = { listProductsQuerySchema, productSelectionSchema, PRODUCT_FILTER_FIELDS };
