const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const importsRepo = require("../repositories/imports.repository");
const productsRepo = require("../repositories/products.repository");
const { getLicenseUsage } = require("../services/license.service");
const importService = require("../services/productImport.service");
const { runImportChunk } = require("../services/importRunner.service");
const { logAuditFromReq } = require("../utils/auditLog");
const { heavyWorkLimiter } = require("../middleware/rateLimit");

// Productimport (Import Center). Alleen voor gebruikers van een klantbedrijf; de
// tenant komt altijd uit de sessie - een import-id van een ander bedrijf is 404.
const router = express.Router();
const IMPORT_ROLES = ["company_admin", "company_user"];

// 4 MB is ruim genoeg voor 10.000 rijen en beperkt het geheugengebruik (zip-bom-check
// in productImport.service.js).
const MAX_FILE_MB = 4;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 }
});

router.use(requireAuth, requireRole(...IMPORT_ROLES), (req, res, next) => {
  if (req.user.companyId == null) {
    next(new HttpError(404, "Niet gevonden"));
    return;
  }
  next();
});

function parseId(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "Niet gevonden");
  return id;
}

async function loadImport(req) {
  const job = await importsRepo.getImport(parseId(req), req.user.companyId);
  if (!job) throw new HttpError(404, "Niet gevonden");
  return job;
}

router.get("/fields", (req, res) => {
  res.json({ fields: importService.IMPORT_FIELDS, maxRows: importService.MAX_IMPORT_ROWS, chunkSize: importService.CHUNK_SIZE, maxFileMb: MAX_FILE_MB });
});

router.get("/template.xlsx", (req, res) => {
  res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.attachment("veripasso-import-template.xlsx");
  res.send(importService.buildTemplateWorkbook());
});

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    res.json(await importsRepo.listImports(req.user.companyId, { page, pageSize: 25 }));
  } catch (error) {
    next(error);
  }
});

// Stap 1: bestand uploaden → parsen → job aanmaken met voorgestelde kolomkoppeling.
router.post(
  "/",
  heavyWorkLimiter,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(400, `Het bestand is te groot (max ${MAX_FILE_MB} MB). Splits het bestand in delen.`));
        return;
      }
      next(err);
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) throw new HttpError(400, "Geen bestand ontvangen.");
      // Bestandsnaam alleen als label: pad-onderdelen en vreemde tekens eruit.
      const filename = String(req.file.originalname || "import")
        .split(/[\\/]/)
        .pop()
        .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
        .slice(0, 200) || "import";
      const { fileType, headers, rows } = importService.parseImportFile(filename, req.file.buffer);
      const columnMapping = importService.suggestMapping(headers);
      const job = await importsRepo.createImport({
        companyId: req.user.companyId,
        createdBy: req.user.id,
        filename,
        fileType,
        headers,
        rows,
        columnMapping
      });
      await logAuditFromReq(req, {
        companyId: req.user.companyId,
        action: "import_upload",
        entityType: "ProductImport",
        entityId: job.id,
        metadata: { filename, rows: rows.length }
      });
      res.status(201).json({ ...job, sample: rows.slice(0, 5) });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    const job = await loadImport(req);
    let sample = [];
    if (["pending", "validating"].includes(job.status)) {
      const rows = await importsRepo.getImportRows(job.id, req.user.companyId);
      sample = (rows || []).slice(0, 5);
    }
    res.json({ ...job, sample });
  } catch (error) {
    next(error);
  }
});

const validateSchema = z.object({
  columnMapping: z.array(z.string().max(60).nullable()).max(60),
  duplicateStrategy: z.enum(["skip", "update", "create"])
});

// Stap 2-5: koppeling + duplicaatstrategie → volledige server-side validatie,
// preview en tellingen. Er wordt nog niets opgeslagen aan producten.
router.post("/:id/validate", validateBody(validateSchema), async (req, res, next) => {
  try {
    const job = await loadImport(req);
    if (!["pending", "validating"].includes(job.status)) {
      throw new HttpError(409, "Deze import is al gestart of afgerond.");
    }
    const rows = (await importsRepo.getImportRows(job.id, req.user.companyId)) || [];
    const columnMapping = importService.normalizeMapping(req.body.columnMapping, job.headers);
    if (!columnMapping.includes("name")) {
      throw new HttpError(400, "Koppel een kolom aan 'Productnaam'; dat veld is verplicht.");
    }

    // Eerst alle rijen zonder databasecheck, dan in één keer de bestaande producten
    // met dezelfde SKU's/GTIN's ophalen (in blokken, nooit per rij).
    const keys = rows.map((row) => importService.identityKeys(importService.validateRow(row, columnMapping).values));
    const skus = [...new Set(keys.map((k) => k.sku).filter(Boolean))];
    const gtins = [...new Set(keys.map((k) => k.gtin).filter(Boolean))];
    const existing = [];
    for (let i = 0; i < Math.max(skus.length, gtins.length); i += 1000) {
      existing.push(
        ...(await productsRepo.findExistingByIdentifiers(req.user.companyId, {
          skus: skus.slice(i, i + 1000),
          gtins: gtins.slice(i, i + 1000)
        }))
      );
    }

    const { results, summary } = importService.validateAll(rows, columnMapping, existing, req.body.duplicateStrategy);
    const errors = importService.flattenIssues(results);
    const errorRows = results.filter((r) => r.action === "error").map((r) => r.row);

    const usage = await getLicenseUsage(req.user.companyId);
    const remaining = usage?.products?.max == null ? null : Math.max(0, usage.products.max - usage.products.used);
    const blocking = [];
    if (usage?.status === "Verlopen") {
      blocking.push("De licentie van dit bedrijf is verlopen; importeren is niet mogelijk.");
    } else if (remaining != null && summary.toCreate > remaining) {
      blocking.push(
        `Je abonnement laat nog ${remaining} nieuwe producten toe; deze import maakt er ${summary.toCreate} aan. Rijen boven de limiet worden niet aangemaakt.`
      );
    }

    await importsRepo.saveValidation(job.id, req.user.companyId, {
      columnMapping,
      duplicateStrategy: req.body.duplicateStrategy,
      summary: { ...summary, remainingCapacity: remaining },
      errors,
      errorRows
    });

    res.json({
      summary: { ...summary, remainingCapacity: remaining },
      blocking,
      preview: results.slice(0, 25).map((r) => ({ row: r.row, action: r.action, values: r.values, issues: r.issues })),
      issues: errors.slice(0, 200),
      issueCount: errors.length
    });
  } catch (error) {
    next(error);
  }
});

// Stap 6: één chunk (250 rijen) verwerken. De client roept dit herhaald aan tot
// done=true; na een refresh gaat het verder waar het was.
router.post("/:id/run", async (req, res, next) => {
  try {
    const id = parseId(req);
    const { done } = await runImportChunk({ importId: id, companyId: req.user.companyId });
    const job = await importsRepo.getImport(id, req.user.companyId);
    res.json({ ...job, done });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/cancel", async (req, res, next) => {
  try {
    const job = await loadImport(req);
    if (!(await importsRepo.cancelImport(job.id, req.user.companyId))) {
      throw new HttpError(409, "Deze import kan niet meer worden geannuleerd.");
    }
    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "import_cancel",
      entityType: "ProductImport",
      entityId: job.id
    });
    res.json(await importsRepo.getImport(job.id, req.user.companyId));
  } catch (error) {
    next(error);
  }
});

// Foutrapport als CSV (puntkomma's, opent direct correct in NL-Excel).
router.get("/:id/errors.csv", async (req, res, next) => {
  try {
    const job = await loadImport(req);
    const errors = (await importsRepo.getImportErrors(job.id, req.user.companyId)) || [];
    const csv = importService.toCsv([
      ["Rij", "Product", "Veld", "Ernst", "Fout", "Suggestie"],
      ...errors.map((e) => [e.row, e.product, e.fieldLabel || e.field, e.severity === "error" ? "Fout" : "Waarschuwing", e.message, e.suggestion])
    ]);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.attachment(`foutrapport-import-${job.id}.csv`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
