const { z } = require("zod");

// 32 random bytes als base64url (zonder padding) = precies 43 tekens. Alles wat daar niet
// op lijkt, hoeft de database niet eens te zien.
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"];

const optionalName = z.string().trim().max(100).optional();

const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ongeldig e-mailadres").max(256),
  firstName: optionalName,
  lastName: optionalName
});

const inviteTokenSchema = z.string().regex(INVITE_TOKEN_PATTERN, "Ongeldige uitnodigingslink");

const lookupInvitationSchema = z.object({
  token: inviteTokenSchema
});

// Voldoet aan de Entra-complexiteitseisen, zodat de Graph-call in Entra-modus niet pas
// ná de invite-checks op het wachtwoord struikelt. Entra staat alleen ASCII toe (geen
// letters met accenten) en maximaal 256 tekens.
const invitePasswordSchema = z
  .string()
  .min(12, "Wachtwoord moet minimaal 12 tekens zijn")
  .max(256, "Wachtwoord mag maximaal 256 tekens zijn")
  .refine((value) => /[A-Z]/.test(value), { message: "Wachtwoord moet minstens één hoofdletter bevatten" })
  .refine((value) => /[a-z]/.test(value), { message: "Wachtwoord moet minstens één kleine letter bevatten" })
  .refine((value) => /[0-9]/.test(value), { message: "Wachtwoord moet minstens één cijfer bevatten" })
  .refine((value) => /[^A-Za-z0-9]/.test(value), { message: "Wachtwoord moet minstens één symbool bevatten" })
  .refine((value) => /^[\x20-\x7E]*$/.test(value), {
    message: "Gebruik alleen letters zonder accenten, cijfers, spaties en gangbare symbolen"
  });

// Bewust géén companyId/role/email: die komen uitsluitend uit de invite-rij. Onbekende
// velden worden door zod gestript, dus meesturen heeft geen effect.
const acceptInvitationSchema = z.object({
  token: inviteTokenSchema,
  password: invitePasswordSchema,
  firstName: optionalName,
  lastName: optionalName
});

module.exports = {
  INVITATION_STATUSES,
  createInvitationSchema,
  lookupInvitationSchema,
  acceptInvitationSchema
};
