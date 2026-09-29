const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const mfaSchema = z.object({
  continuationToken: z.string().min(1),
  code: z.string().min(1)
});

// Zelfbeheer profiel: alleen naamvelden - rol, status en e-mail zijn hier bewust
// niet wijzigbaar.
const updateMeSchema = z
  .object({
    firstName: z.string().min(1, "Vul een voornaam in").max(100).optional(),
    lastName: z.string().min(1, "Vul een achternaam in").max(100).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { loginSchema, mfaSchema, updateMeSchema };
