const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

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
    .max(256, "Wachtwoord mag maximaal 256 tekens zijn")
});

module.exports = { loginSchema, updateMeSchema, changePasswordSchema };
