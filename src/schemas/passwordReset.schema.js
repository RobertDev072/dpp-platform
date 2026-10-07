const { z } = require("zod");

const startResetSchema = z.object({ email: z.string().email() });
const continueTokenSchema = z.object({ continuationToken: z.string().min(1) });
const submitCodeSchema = z.object({
  continuationToken: z.string().min(1),
  code: z.string().min(1)
});
const submitPasswordSchema = z.object({
  continuationToken: z.string().min(1),
  password: z
    .string()
    .min(12, "Wachtwoord moet minimaal 12 tekens zijn")
    .max(256, "Wachtwoord mag maximaal 256 tekens zijn"),
  // Worden door de (bestaande) frontend nog meegestuurd maar niet meer gebruikt: de
  // code is in de vorige stap al door Supabase gecontroleerd en het account staat
  // in het ondertekende continuationToken.
  code: z.string().optional(),
  email: z.string().email().optional()
});

module.exports = { startResetSchema, continueTokenSchema, submitCodeSchema, submitPasswordSchema };
