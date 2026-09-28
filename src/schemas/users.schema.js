const { z } = require("zod");

const ROLES = ["system_owner", "company_admin", "company_user", "viewer"];

const createUserSchema = z.object({
  companyId: z.number().int().positive().nullable().optional(),
  email: z.string().email(),
  // Alleen gebruikt/verplicht in legacy (niet-Entra) modus — zie users.routes.js.
  // Zodra Entra is geconfigureerd genereert de backend zelf een tijdelijk wachtwoord.
  password: z.string().min(12, "Wachtwoord moet minimaal 12 tekens zijn").optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  role: z.enum(ROLES),
  status: z.enum(["active", "inactive"]).optional()
});

const updateUserSchema = z
  .object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(["active", "inactive"]).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { ROLES, createUserSchema, updateUserSchema };
