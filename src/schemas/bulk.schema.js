const { z } = require("zod");

const MAX_IDS = 1000;

const productFilterSchema = z
  .object({
    q: z.string().max(200).optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
    category: z.string().max(100).optional(),
    doc: z.enum(["compleet", "incompleet"]).optional()
  })
  .strict();

// Selectie voor bulkacties: expliciete ids óf een filter ("alle resultaten").
// De server voegt zelf altijd het bedrijf van de ingelogde gebruiker toe.
const productBulkSchema = z
  .object({
    action: z.enum(["publish", "archive", "restore", "set_category", "reserve_qr"]),
    ids: z.array(z.number().int().positive()).min(1).max(MAX_IDS).optional(),
    filter: productFilterSchema.optional(),
    category: z.string().trim().max(100).nullable().optional(),
    includeIncomplete: z.boolean().optional()
  })
  .refine((data) => Boolean(data.ids) !== Boolean(data.filter), {
    message: "Geef óf ids óf een filter mee"
  })
  .refine((data) => data.action !== "set_category" || data.category !== undefined, {
    message: "Kies een categorie"
  });

const importRowSchema = z.object({
  row: z.number().int().positive(),
  values: z.record(z.string(), z.union([z.string().max(10000), z.number(), z.boolean(), z.null()]))
});

const importRowsSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(250)
});

const createImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  totalRows: z.number().int().min(1).max(20000),
  duplicateMode: z.enum(["skip", "update", "create"]),
  mapping: z.record(z.string().max(200), z.string().max(50).nullable()).optional()
});

const finishImportSchema = z.object({
  cancelled: z.boolean().optional()
});

const qrQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  qrStatus: z.enum(["none", "reserved", "active", "archived"]).optional(),
  sort: z.enum(["name", "scans", "recent"]).default("name"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(24)
});

const qrByIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_IDS)
});

module.exports = {
  MAX_IDS,
  productBulkSchema,
  importRowsSchema,
  createImportSchema,
  finishImportSchema,
  qrQuerySchema,
  qrByIdsSchema
};
