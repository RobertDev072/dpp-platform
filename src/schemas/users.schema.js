const { z } = require("zod");
const { OWNER_ASSIGNABLE_ROLES } = require("../utils/roles");

// platform_owner staat bewust niet in dit enum: die rol is via de API nooit toe te
// kennen (er is er precies één, beheerd via het seed-script).
const USER_STATUSES = ["active", "blocked", "suspended", "archived", "deleted"];

const createUserSchema = z.object({
  companyId: z.number().int().positive().nullable().optional(),
  email: z.string().email(),
  // Alleen gebruikt/verplicht in legacy (niet-Entra) modus — zie users.routes.js.
  // Zodra Entra is geconfigureerd genereert de backend zelf een tijdelijk wachtwoord.
  password: z.string().min(12, "Wachtwoord moet minimaal 12 tekens zijn").optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  role: z.enum(OWNER_ASSIGNABLE_ROLES),
  status: z.enum(USER_STATUSES).optional()
});

const updateUserSchema = z
  .object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    role: z.enum(OWNER_ASSIGNABLE_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { ROLES: OWNER_ASSIGNABLE_ROLES, USER_STATUSES, createUserSchema, updateUserSchema };
