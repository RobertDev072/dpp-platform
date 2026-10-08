const { z } = require("zod");

const DOCUMENT_CATEGORIES = ["document", "manual", "video", "3d_model", "certificate", "declaration"];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik een datum (JJJJ-MM-DD)")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Ongeldige datum");

const createDocumentSchema = z.object({
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  language: z.string().max(10).optional(),
  storageUrl: z.string().min(1).max(1000),
  isPublic: z.boolean().optional().default(false),
  category: z.enum(DOCUMENT_CATEGORIES).optional().default("document"),
  validUntil: isoDate.optional(),
  version: z.string().max(30).optional()
});

const updateDocumentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    isPublic: z.boolean().optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    language: z.string().max(10).optional(),
    validUntil: isoDate.nullable().optional(),
    version: z.string().max(30).nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { createDocumentSchema, updateDocumentSchema, DOCUMENT_CATEGORIES, isoDate };
