const { z } = require("zod");
const { ALL_ROLES } = require("../auth/permissions");
const { emailField } = require("./auth.schema");

// Alle rollen mogen door de schema-validatie; welke rol iemand daadwerkelijk mag toekennen
// is autorisatie en wordt in users.routes.js gecheckt (403/400 met een duidelijke code).
const ROLES = ALL_ROLES;
const USER_STATUSES = ["active", "inactive", "blocked"];

// Zelfde eisen als bij het activeren van een uitnodiging (en de Entra-complexiteitseisen),
// zodat een lokaal gekozen wachtwoord later ook als Entra-wachtwoord zou voldoen.
const passwordField = z
  .string()
  .min(12, "Wachtwoord moet minimaal 12 tekens zijn")
  .max(256, "Wachtwoord is te lang")
  .regex(/[a-z]/, "Wachtwoord moet een kleine letter bevatten")
  .regex(/[A-Z]/, "Wachtwoord moet een hoofdletter bevatten")
  .regex(/[0-9]/, "Wachtwoord moet een cijfer bevatten")
  .regex(/[^A-Za-z0-9]/, "Wachtwoord moet een symbool bevatten");

// Lege string = veld leegmaken (NULL), zodat een formulier met een leeg naamveld werkt.
const nameField = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .optional()
  .transform((value) => (value === "" ? null : value));

// Bewust niet .strict(): een Company Admin die toch een companyId meestuurt, krijgt geen
// fout maar die waarde wordt in de route genegeerd (tenant komt altijd uit de sessie).
const createUserSchema = z.object({
  companyId: z.number().int().positive().nullable().optional(),
  email: emailField,
  // Alleen gebruikt in lokale modus; zonder wachtwoord genereert de backend een tijdelijk
  // wachtwoord. In Entra-modus genereert de backend altijd zelf een tijdelijk wachtwoord.
  password: passwordField.optional(),
  firstName: nameField,
  lastName: nameField,
  role: z.enum(ROLES),
  // Een nieuwe gebruiker direct blokkeren is zinloos; 'inactive' kan wel (telt geen seat).
  status: z.enum(["active", "inactive"]).optional()
});

// .strict(): velden als companyId/email/password horen niet bij een PATCH; liever een
// duidelijke 400 dan dat een poging tot verplaatsen stil lijkt te lukken.
const updateUserSchema = z
  .object({
    firstName: nameField,
    lastName: nameField,
    role: z.enum(ROLES).optional(),
    status: z.enum(USER_STATUSES).optional()
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Geen velden om bij te werken"
  });

// Query-filters voor GET /api/users. companyId wordt apart met parseOptionalId geparsed en
// alleen voor de System Owner gebruikt.
const listUsersQuerySchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional()
});

module.exports = { ROLES, USER_STATUSES, passwordField, createUserSchema, updateUserSchema, listUsersQuerySchema };
