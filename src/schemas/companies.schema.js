const { z } = require("zod");

// Leeg veld = wissen (null); anders een geldig e-mailadres.
const optionalEmail = z
  .union([z.string().trim().email("Vul een geldig e-mailadres in").max(200), z.literal("")])
  .nullable()
  .optional()
  .transform((v) => (v === "" ? null : v));

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(slugPattern, "Alleen kleine letters, cijfers en koppeltekens"),
  planId: z.number().int().positive().nullable().optional(),
  // Alleen relevant voor de Platform Owner: partners hebben zelf geen partner en
  // geen productmodules; klanten kunnen aan een partner gekoppeld worden.
  kind: z.enum(["customer", "partner"]).optional(),
  partnerId: z.number().int().positive().nullable().optional(),
  licenseStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik het formaat JJJJ-MM-DD").nullable().optional(),
  licenseEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik het formaat JJJJ-MM-DD").nullable().optional()
});

const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().min(1).max(100).regex(slugPattern).optional(),
    planId: z.number().int().positive().nullable().optional(),
    status: z.enum(["active", "blocked", "suspended", "archived"]).optional(),
    partnerId: z.number().int().positive().nullable().optional(),
    licenseStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik het formaat JJJJ-MM-DD")
      .nullable()
      .optional(),
    licenseEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Gebruik het formaat JJJJ-MM-DD")
      .nullable()
      .optional(),
    contactName: z.string().trim().max(200).nullable().optional(),
    contactEmail: optionalEmail,
    contactPhone: z.string().trim().max(50).nullable().optional(),
    billingEmail: optionalEmail,
    billingReference: z.string().trim().max(100).nullable().optional(),
    vatNumber: z.string().trim().max(30).nullable().optional(),
    notes: z.string().max(5000).nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { createCompanySchema, updateCompanySchema };
