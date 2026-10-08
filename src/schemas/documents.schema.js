const { z } = require("zod");

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik een geldige datum");

const createDocumentSchema = z.object({
  type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  language: z.string().max(10).optional(),
  storageUrl: z.string().min(1).max(1000),
  isPublic: z.boolean().optional().default(false),
  category: z.enum(["document", "manual", "video", "3d_model"]).optional().default("document"),
  version: z.string().trim().max(30).nullable().optional(),
  validUntil: dateString.nullable().optional().or(z.literal(""))
});

const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1, "Vul een titel in").max(200).optional(),
    language: z.string().trim().max(10).nullable().optional(),
    version: z.string().trim().max(30).nullable().optional(),
    validUntil: dateString.nullable().optional().or(z.literal("")),
    isPublic: z.boolean().optional(),
    category: z.enum(["document", "manual", "video", "3d_model"]).optional(),
    archived: z.boolean().optional()
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "Geen velden om bij te werken" });

const documentBulkSchema = z
  .object({
    action: z.enum(["publish", "unpublish", "archive", "restore"]),
    ids: z.array(z.number().int().positive()).min(1).max(1000)
  })
  .strict();

const documentIdsSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }).strict();

module.exports = { createDocumentSchema, updateDocumentSchema, documentBulkSchema, documentIdsSchema };
