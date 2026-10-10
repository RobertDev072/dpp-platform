const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

// Tweede stap bij inloggen: TOTP-code óf een eenmalige herstelcode.
const mfaVerifySchema = z
  .object({
    ticket: z.string().min(1).max(500),
    code: z.string().max(20).optional(),
    recoveryCode: z.string().max(20).optional()
  })
  .refine((d) => Boolean(d.code) !== Boolean(d.recoveryCode), { message: "Vul een code of een herstelcode in" });

const mfaEnableSchema = z.object({ code: z.string().min(6).max(10) });

const mfaDisableSchema = z
  .object({
    password: z.string().min(1),
    code: z.string().max(20).optional(),
    recoveryCode: z.string().max(20).optional()
  })
  .refine((d) => Boolean(d.code) !== Boolean(d.recoveryCode), { message: "Vul een code of een herstelcode in" });

// Zelfbeheer profiel: alleen naamvelden - rol, status en e-mail zijn hier bewust
// niet wijzigbaar.
const updateMeSchema = z
  .object({
    firstName: z.string().min(1, "Vul een voornaam in").max(100).optional(),
    lastName: z.string().min(1, "Vul een achternaam in").max(100).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

// Gedwongen wachtwoordwijziging bij eerste login met een tijdelijk wachtwoord.
const changePasswordSchema = z.object({
  email: z.string().email(),
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(12, "Wachtwoord moet minimaal 12 tekens zijn")
    .max(256, "Wachtwoord mag maximaal 256 tekens zijn"),
  // Verplicht als het account tweestapsverificatie heeft (anders zou een
  // wachtwoordreset door een beheerder de tweede factor omzeilen).
  mfaCode: z.string().max(20).optional(),
  recoveryCode: z.string().max(20).optional()
});

module.exports = { loginSchema, mfaVerifySchema, mfaEnableSchema, mfaDisableSchema, updateMeSchema, changePasswordSchema };
