const { z } = require("zod");

// Lege string = veld leegmaken (NULL).
function optionalText(max) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));
}

// Alleen de velden die een Company Admin zelf mag bijhouden. Naam, KvK, plan, seats en
// status zijn voorbehouden aan de System Owner (via /api/admin/companies). .strict(): een
// poging om zo'n veld mee te sturen geeft een 400 en er wordt niets (half) opgeslagen.
const updateOwnCompanySchema = z
  .object({
    address: optionalText(500),
    country: optionalText(100),
    contactName: optionalText(200),
    contactEmail: z
      .union([z.string().trim().toLowerCase().max(256).email(), z.literal("")])
      .nullable()
      .optional()
      .transform((value) => (value === "" ? null : value))
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Geen velden om bij te werken"
  });

// Query van GET /api/company/audit. Query-waarden zijn altijd strings, vandaar coerce.
const companyAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  action: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z_]+$/, "Ongeldige actie")
    .optional()
    .or(z.literal("").transform(() => undefined))
});

module.exports = { updateOwnCompanySchema, companyAuditQuerySchema };
