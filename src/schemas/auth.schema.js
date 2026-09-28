const { z } = require("zod");

// E-mailadressen normaliseren we overal (trim + lowercase), zodat "Jan@X.nl" en "jan@x.nl"
// hetzelfde account zijn en de rate limiter ze niet als twee verschillende sleutels telt.
const emailField = z.string().trim().toLowerCase().max(256).email();

const loginSchema = z.object({
  email: emailField,
  // Bovengrens: bcrypt kijkt maar naar 72 bytes, en een megabyte-"wachtwoord" hoeven we
  // niet eerst te hashen om te weigeren.
  password: z.string().min(1).max(1024)
});

// Stap 1 van de Entra-login (form-post vanaf /login.html). Alleen gebruikt als login_hint;
// ongeldige invoer is geen fout, dan starten we de flow gewoon zonder hint.
const entraLoginHintSchema = z.object({
  email: emailField
});

// Entra stuurt de callback als urlencoded form-post. Met express.urlencoded kan een veld
// ook een array zijn (herhaalde sleutel): daarom expliciet strings met een bovengrens.
const entraCallbackSchema = z.object({
  code: z.string().min(1).max(8192).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(256).optional(),
  error_description: z.string().max(2048).optional()
});

module.exports = { emailField, loginSchema, entraLoginHintSchema, entraCallbackSchema };
