const { z } = require("zod");

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(150).optional(),
  model: z.string().max(150).optional(),
  sku: z.string().max(100).optional(),
  gtin: z.string().max(50).optional(),
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
    description: z.string().optional(),
    manufacturer: z.string().max(200).optional(),
    countryOfOrigin: z.string().max(100).optional(),
    photoUrl: z.string().max(1000).optional(),
    // photoBlobName is bewust geen onderdeel van dit schema: die kolom mag alleen door
    // de server gezet worden na een geverifieerde upload (products.routes.js), nooit
    // rechtstreeks door een client - anders zou een company-gebruiker een willekeurige
    // blobnaam kunnen invullen en zo andermans geuploade bestand aan het eigen product
    // kunnen koppelen.
    status: z.enum(["draft", "archived"]).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Geen velden om bij te werken" });

module.exports = { createProductSchema, updateProductSchema };
