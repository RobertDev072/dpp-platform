const { z } = require("zod");

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const COMPANY_STATUSES = ["active", "suspended", "archived"];

// Formulieren sturen een leeg veld mee als "": dat betekent "leegmaken", niet "ongeldig".
const emptyToNull = (value) => (typeof value === "string" && value.trim() === "" ? null : value);

const optionalText = (max) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();

const companyFields = {
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(100).regex(slugPattern, "Alleen kleine letters, cijfers en koppeltekens"),
  kvkNumber: optionalText(20),
  country: optionalText(100),
  address: optionalText(500),
  contactName: optionalText(200),
  contactEmail: z.preprocess(emptyToNull, z.string().trim().email("Ongeldig e-mailadres").max(256).nullable()).optional(),
  planId: z.number().int().positive().nullable().optional(),
  // null = volg Plans.max_users (zie §3 in docs/architecture-roles.md).
  maxUsers: z.number().int().min(0).max(1000000).nullable().optional(),
  status: z.enum(COMPANY_STATUSES).optional()
};

const createCompanySchema = z.object({
  ...companyFields,
  // Optioneel: zonder slug leidt de backend een unieke slug af van de naam.
  slug: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), companyFields.slug.optional())
});

const updateCompanySchema = z
  .object({
    ...companyFields,
    name: companyFields.name.optional(),
    slug: companyFields.slug.optional()
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Geen velden om bij te werken" });

module.exports = { COMPANY_STATUSES, createCompanySchema, updateCompanySchema };
