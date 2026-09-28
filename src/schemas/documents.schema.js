const { z } = require("zod");

const DOCUMENT_TYPES = Object.freeze(["manual", "certificate", "declaration", "safety", "repair", "recycling", "other"]);

const URL_MAX = 1000;

const emptyToNull = (value) => (typeof value === "string" && value.trim() === "" ? null : value);
const emptyToUndefined = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

// Documenten zijn links (geen Blob-opslag) en belanden als <a href> op de publieke DPP-pagina.
// Daarom alleen https: javascript:/data:/vbscript: zouden daar XSS opleveren en http: een
// onversleutelde (en te manipuleren) download. Gebruikersnaam/wachtwoord in de URL weigeren
// we ook: dat zijn credentials die daarna publiek zichtbaar en in de DB zouden staan.
function isSafeHttpsUrl(value) {
  if (typeof value !== "string") return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  // Een hostnaam zonder punt ("https:/intranet", "https://localhost") is nooit een link die
  // een bezoeker van de publieke pagina kan openen.
  return parsed.protocol === "https:" && parsed.hostname.includes(".") && !parsed.username && !parsed.password;
}

// Opgeslagen in genormaliseerde vorm (URL.href): spaties en andere tekens zijn dan
// ge-escaped, zodat wat in de DB staat precies is wat de browser straks opent.
const urlField = z
  .string()
  .trim()
  .min(1, "URL is verplicht")
  .max(URL_MAX)
  .refine(isSafeHttpsUrl, { message: "Alleen https-links zijn toegestaan" })
  .transform((value) => new URL(value).href)
  .pipe(z.string().max(URL_MAX, "URL is te lang"));

const titleField = z.string().trim().min(1, "Titel is verplicht").max(200);

// Taalcode zoals "nl", "en" of "nl-NL". Kort en zonder vrije tekst: het veld komt op de
// publieke pagina terecht.
const languageField = z
  .preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .max(10)
      .regex(/^[A-Za-z0-9-]+$/, "Ongeldige taalcode")
      .nullable()
  )
  .optional();

// Niet .strict(): een meegestuurde companyId/productId wordt gestript. Het product komt uit
// de URL en de company altijd van het product, nooit uit de body.
const createDocumentSchema = z.object({
  title: titleField,
  type: z.enum(DOCUMENT_TYPES),
  language: languageField,
  url: urlField,
  // Standaard niet publiek: een vergeten vinkje mag nooit per ongeluk iets openbaar maken.
  isPublic: z.boolean().optional().default(false)
});

const updateDocumentSchema = z
  .object({
    title: titleField.optional(),
    type: z.enum(DOCUMENT_TYPES).optional(),
    language: languageField,
    url: urlField.optional(),
    isPublic: z.boolean().optional()
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Geen velden om bij te werken"
  });

// Query-filters voor GET /api/documents. productId/companyId worden apart met
// parseOptionalId geparsed; companyId alleen voor de System Owner.
const listDocumentsQuerySchema = z.object({
  type: z.preprocess(emptyToUndefined, z.enum(DOCUMENT_TYPES).optional())
});

module.exports = {
  DOCUMENT_TYPES,
  isSafeHttpsUrl,
  createDocumentSchema,
  updateDocumentSchema,
  listDocumentsQuerySchema
};
