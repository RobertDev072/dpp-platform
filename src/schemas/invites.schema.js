const { z } = require("zod");

const createInviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional()
});

const acceptInviteSchema = z.object({
  // Alleen verplicht/gebruikt zolang Entra niet geconfigureerd is — zelfde uitzondering
  // als password in users.schema.js.
  password: z.string().min(12, "Wachtwoord moet minimaal 12 tekens zijn").optional()
});

module.exports = { createInviteSchema, acceptInviteSchema };
