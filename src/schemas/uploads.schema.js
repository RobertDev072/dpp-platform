const { z } = require("zod");

// Stap 1 van een directe upload naar Supabase Storage: de browser vertelt wat hij wil
// uploaden; de server controleert type en grootte vóórdat er een upload-URL komt.
const uploadRequestSchema = z.object({
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive()
});

const photoUploadRequestSchema = uploadRequestSchema;
const documentUploadRequestSchema = uploadRequestSchema;

// Stap 2: het pad dat de server in stap 1 heeft uitgegeven.
const uploadPath = z.string().min(1).max(300);

const photoUploadCompleteSchema = z.object({
  path: uploadPath
});

const documentUploadCompleteSchema = z.object({
  path: uploadPath,
  title: z.string().trim().min(1, "Vul een titel in").max(200),
  type: z.string().trim().max(50).optional(),
  language: z.string().trim().max(10).nullable().optional(),
  isPublic: z.boolean().optional().default(false),
  category: z.enum(["document", "manual", "video", "3d_model"]).optional().default("document")
});

module.exports = {
  photoUploadRequestSchema,
  photoUploadCompleteSchema,
  documentUploadRequestSchema,
  documentUploadCompleteSchema
};
