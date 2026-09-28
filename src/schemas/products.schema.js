const { z } = require("zod");
const { PRODUCT_STATUSES } = require("../services/productWorkflow");
const { QR_MIN_SIZE, QR_MAX_SIZE } = require("../services/qr.service");

// Formulieren sturen een leeg veld mee als "": dat betekent "leegmaken" (NULL), niet "ongeldig".
const emptyToNull = (value) => (typeof value === "string" && value.trim() === "" ? null : value);
const emptyToUndefined = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const optionalText = (max) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();

// Lange vrije tekstvelden (NVARCHAR(MAX) in de DB) krijgen toch een bovengrens: de body-limiet
// van 100kb vangt veel af, maar één veld hoort niet de hele body te kunnen vullen.
const LONG_TEXT_MAX = 20000;

// Welke permissie een veld vereist (zie §8 "Producten, documenten, QR"). De route checkt
// per meegestuurd veld; zo kan een compliance manager nooit de naam wijzigen en een
// medewerker nooit de materialen, ook niet door velden te combineren.
const GENERAL_FIELDS = Object.freeze([
  "name",
  "sku",
  "manufacturer",
  "brand",
  "model",
  "gtin",
  "category",
  "description",
  "adminNotes"
]);
const COMPLIANCE_FIELDS = Object.freeze([
  "materials",
  "countryOfOrigin",
  "complianceInfo",
  "recyclingInfo",
  "repairInfo"
]);

const productFields = {
  name: z.string().trim().min(1, "Naam is verplicht").max(200),
  sku: optionalText(100),
  manufacturer: optionalText(200),
  brand: optionalText(150),
  model: optionalText(150),
  gtin: optionalText(50),
  category: optionalText(100),
  description: optionalText(LONG_TEXT_MAX),
  // Intern veld: komt nooit in de publieke DTO.
  adminNotes: optionalText(LONG_TEXT_MAX),
  materials: optionalText(LONG_TEXT_MAX),
  countryOfOrigin: optionalText(100),
  complianceInfo: optionalText(LONG_TEXT_MAX),
  recyclingInfo: optionalText(LONG_TEXT_MAX),
  repairInfo: optionalText(LONG_TEXT_MAX)
};

// Niet .strict(): een meegestuurde companyId/status/createdBy wordt gestript en dus genegeerd.
// Tenant, status ('draft') en created_by komen altijd van de backend.
const createProductSchema = z.object(productFields);

// .strict(): onbekende velden bij een wijziging zijn vrijwel altijd een fout (of een poging
// om iets te zetten dat niet mag); liever een duidelijke 400 dan een stille no-op.
const updateProductSchema = z
  .object({
    ...productFields,
    name: productFields.name.optional(),
    // Status loopt uitsluitend via POST /:id/status, waar de transitieregels en de
    // publicatie-checklist gelden. Een eigen melding maakt dat voor de client duidelijk.
    status: z.never({ error: "Status wijzig je via POST /api/products/:id/status" }).optional()
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Geen velden om bij te werken"
  });

const productStatusSchema = z.object({ status: z.enum(PRODUCT_STATUSES) }).strict();

// Query-filters voor GET /api/products. companyId wordt apart met parseOptionalId geparsed
// en alleen voor de System Owner gebruikt.
const listProductsQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(PRODUCT_STATUSES).optional()),
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  category: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional())
});

const qrQuerySchema = z.object({
  size: z.preprocess(emptyToUndefined, z.coerce.number().int().min(QR_MIN_SIZE).max(QR_MAX_SIZE).optional()),
  download: z.preprocess(emptyToUndefined, z.enum(["0", "1"]).optional())
});

module.exports = {
  GENERAL_FIELDS,
  COMPLIANCE_FIELDS,
  createProductSchema,
  updateProductSchema,
  productStatusSchema,
  listProductsQuerySchema,
  qrQuerySchema
};
