const { z } = require("zod");

// Taalcode: ISO 639 (2–3 letters), optioneel met regio (ISO 3166), bijv. nl, nl-NL, en-GB.
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(150).optional(),
  model: z.string().max(150).optional(),
  sku: z.string().max(100).optional(),
  gtin: z.string().max(50).optional(),
  categoryLabel: z.string().max(100).optional(),
  description: z.string().optional(),
  manufacturer: z.string().max(200).optional(),
  countryOfOrigin: z.string().max(100).optional(),
  photoUrl: z.string().max(1000).optional()
});

const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    brand: z.string().max(150).optional(),
    model: z.string().max(150).optional(),
    sku: z.string().max(100).optional(),
    gtin: z.string().max(50).optional(),
    categoryLabel: z.string().max(100).optional(),
    description: z.string().optional(),
    manufacturer: z.string().max(200).optional(),
    countryOfOrigin: z.string().max(100).optional(),
    photoUrl: z.string().max(1000).optional(),
    // photoBlobName is bewust geen onderdeel van dit schema: die kolom mag alleen door
    // de server gezet worden na een geverifieerde upload (products.routes.js), nooit
    // rechtstreeks door een client - anders zou een company-gebruiker een willekeurige
    // blobnaam kunnen invullen en zo andermans geuploade bestand aan het eigen product
    // kunnen koppelen.
    status: z.enum(["draft", "archived"]).optional(),
    // DPP-interoperabiliteit: vestiging (bijv. GLN), verwijzingen naar toepasselijke
    // wetgeving/normen, en de taal van de basisteksten (BCP 47, bijv. nl-NL).
    facilityId: z.string().trim().max(100).nullable().optional(),
    contentSpecificationIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    language: z.string().regex(LANGUAGE_PATTERN, "Gebruik een taalcode zoals nl-NL of en").optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

const translationSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(20000).nullable().optional()
});

module.exports = { createProductSchema, updateProductSchema, translationSchema, LANGUAGE_PATTERN };
