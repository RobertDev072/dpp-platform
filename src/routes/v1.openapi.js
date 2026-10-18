// OpenAPI 3.1-beschrijving van de B2B-API (/api/v1) en JSON Schema van het paspoort.
// Handgeschreven en klein gehouden; tests controleren dat elke route hierin staat.

function dppJsonSchema(base) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${base}/api/v1/schema/dpp.json`,
    title: "VeriPasso digitaal productpaspoort",
    description: "dppSchemaVersion 1.0.0. Onbekende velden moeten door afnemers worden genegeerd.",
    type: "object",
    required: ["digitalProductPassportId", "uniqueProductIdentifier", "granularity", "dppSchemaVersion", "dppStatus", "lastUpdated", "product", "dataElements"],
    properties: {
      digitalProductPassportId: { type: "string", pattern: "^urn:uuid:[0-9a-f-]{36}$" },
      uniqueProductIdentifier: { type: "string", format: "uri" },
      granularity: { enum: ["model", "batch", "item"] },
      dppSchemaVersion: { type: "string", const: "1.0.0" },
      dppStatus: { enum: ["Active", "Archived", "Draft"] },
      lastUpdated: { type: ["string", "null"], format: "date-time" },
      economicOperatorId: { type: ["string", "null"] },
      economicOperatorIdScheme: { enum: ["lei", "gln", "eori", "vat", "duns", "kvk", "other", null] },
      facilityId: { type: ["string", "null"] },
      contentSpecificationIds: { type: "array", items: { type: "string" } },
      language: { type: "string" },
      id: { type: "string", format: "uri", description: "Paspoort-URL (zoals in de QR-code)" },
      identifiers: { type: "object" },
      product: {
        type: "object",
        properties: {
          name: { type: "string" },
          nameMultiLanguage: { $ref: "#/$defs/multiLanguage" },
          descriptionMultiLanguage: { $ref: "#/$defs/multiLanguage" }
        }
      },
      dataElements: {
        type: "array",
        items: {
          type: "object",
          required: ["elementId", "type", "value", "dictionaryReference"],
          properties: {
            elementId: { type: "string" },
            type: { enum: ["DataElement", "MultiLanguageDataElement"] },
            value: {},
            dictionaryReference: { type: "string", format: "uri" },
            unitCode: { type: "string", description: "UN/CEFACT Rec. 20" }
          }
        }
      },
      relatedResources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            resourceType: { type: "string" },
            title: { type: "string" },
            mimeType: { type: ["string", "null"] },
            language: { type: ["string", "null"] },
            url: { type: ["string", "null"], format: "uri" },
            validUntil: { type: ["string", "null"], format: "date" }
          }
        }
      }
    },
    $defs: {
      multiLanguage: {
        type: "array",
        items: { type: "object", required: ["language", "value"], properties: { language: { type: "string" }, value: { type: "string" } } }
      }
    }
  };
}

const dppIdParam = {
  name: "dppId",
  in: "path",
  required: true,
  description: "UUID, urn:uuid:… of paspoort-URL",
  schema: { type: "string" }
};
const errors = {
  400: { description: "Ongeldige invoer" },
  401: { description: "API-sleutel ontbreekt of is ongeldig" },
  403: { description: "Sleutel zonder write-recht" },
  404: { description: "Niet gevonden (of niet van dit bedrijf)" },
  429: { description: "Te veel aanvragen" }
};
const dppResponse = { description: "Paspoort", content: { "application/json": { schema: { $ref: "#/components/schemas/DPP" } } } };

function openApiDocument(base) {
  return {
    openapi: "3.1.0",
    info: {
      title: "VeriPasso DPP API",
      version: "1.0.0",
      description:
        "Lezen is publiek (alleen gepubliceerde paspoorten). Schrijven vraagt een API-sleutel van het bedrijf (Bedrijfsinstellingen → API-sleutels) met write-recht: Authorization: Bearer vp_…"
    },
    servers: [{ url: `${base}/api/v1` }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "vp_xxxxxxxx_…" } },
      schemas: { DPP: { $ref: `${base}/api/v1/schema/dpp.json` } }
    },
    paths: {
      "/dpp/{dppId}": {
        get: {
          operationId: "ReadDPPById",
          summary: "Paspoort ophalen; met ?at=ISO-datum de versie op dat moment (ReadDPPVersionByIdAndDate)",
          parameters: [dppIdParam, { name: "at", in: "query", schema: { type: "string", format: "date-time" } }, { name: "version", in: "query", schema: { type: "integer" } }],
          responses: { 200: dppResponse, ...errors }
        },
        patch: {
          operationId: "UpdateDPPById",
          security: [{ apiKey: [] }],
          parameters: [dppIdParam],
          requestBody: { content: { "application/json": { schema: { type: "object", description: "Productvelden, sustainability, compliance, dppStatus" } } } },
          responses: { 200: dppResponse, ...errors }
        },
        delete: {
          operationId: "DeleteDPPById",
          summary: "Archiveren: het paspoort blijft raadpleegbaar met dppStatus Archived",
          security: [{ apiKey: [] }],
          parameters: [dppIdParam],
          responses: { 200: dppResponse, ...errors }
        }
      },
      "/dpp": {
        get: {
          operationId: "ReadDPPByProductId",
          parameters: [{ name: "productId", in: "query", required: true, description: "GTIN, GS1 Digital Link of urn:uuid", schema: { type: "string" } }],
          responses: { 200: dppResponse, ...errors }
        },
        post: {
          operationId: "CreateDPP",
          security: [{ apiKey: [] }],
          requestBody: { content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, gtin: { type: "string" }, publish: { type: "boolean" } } } } } },
          responses: { 201: dppResponse, ...errors }
        }
      },
      "/dpp/search": {
        post: {
          operationId: "ReadDPPIdsByProductIds",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["productIds"],
                  properties: { productIds: { type: "array", maxItems: 100, items: { type: "string" } }, page: { type: "integer" }, pageSize: { type: "integer", maximum: 100 } }
                }
              }
            }
          },
          responses: { 200: { description: "{ items: [{ productId, digitalProductPassportId }], page, pageSize, total, pages }" }, ...errors }
        }
      },
      "/dpp/{dppId}/elements/{elementId}": {
        get: {
          operationId: "ReadDataElement",
          parameters: [dppIdParam, { name: "elementId", in: "path", required: true, schema: { type: "string" }, example: "product.name" }],
          responses: { 200: { description: "Dataveld met dictionaryReference" }, ...errors }
        },
        put: {
          operationId: "UpdateDataElement",
          security: [{ apiKey: [] }],
          parameters: [dppIdParam, { name: "elementId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { type: "object", required: ["value"], properties: { value: {} } } } } },
          responses: { 200: { description: "Bijgewerkt dataveld" }, ...errors }
        }
      },
      "/dpp/{dppId}/register": {
        post: {
          operationId: "RegisterProductDPP",
          summary: "Aanmelden bij het EU DPP-register (zodra dat operationeel is)",
          security: [{ apiKey: [] }],
          parameters: [dppIdParam],
          responses: { 202: { description: "In de wachtrij voor het register" }, ...errors }
        }
      }
    }
  };
}

module.exports = { openApiDocument, dppJsonSchema };
