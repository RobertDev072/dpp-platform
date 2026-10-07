const { z } = require("zod");

const createInviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional()
});

const acceptInviteSchema = z.object({
  // Het eigen wachtwoord van de nieuwe beheerder (verplicht; de route geeft een
  // nette veldfout als het ontbreekt).
  password: z
    .string()
    .min(12, "Wachtwoord moet minimaal 12 tekens zijn")
    .max(256, "Wachtwoord mag maximaal 256 tekens zijn")
    .optional()
});

module.exports = { createInviteSchema, acceptInviteSchema };
