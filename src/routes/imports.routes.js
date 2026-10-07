const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { importRowsSchema, createImportSchema, finishImportSchema } = require("../schemas/bulk.schema");
const importService = require("../services/productImport.service");
const { logAuditFromReq } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// Import is een bedrijfsfunctie: alleen gebruikers ván een bedrijf, en altijd voor
// hun eigen bedrijf (req.user.companyId uit de sessie - nooit uit de request).
router.use(requireAuth, requireRole("company_admin", "company_user"));

function companyIdOf(req) {
  if (req.user.companyId == null) throw new HttpError(403, "Geen toegang");
  return req.user.companyId;
}

// Validatie + duplicaatcontrole zonder te schrijven (stap "Voorvertoning").
router.post("/preview", validateBody(importRowsSchema), async (req, res, next) => {
  try {
    res.json({ results: await importService.previewRows(companyIdOf(req), req.body.rows) });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json(await importService.listJobs(companyIdOf(req), { page }));
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createImportSchema), async (req, res, next) => {
  try {
    const job = await importService.createJob({
      companyId: companyIdOf(req),
      userId: req.user.id,
      ...req.body
    });
    await logAuditFromReq(req, {
      companyId: job.company_id,
      action: "import_started",
      entityType: "ImportJob",
      entityId: job.id,
      metadata: { fileName: job.file_name, totalRows: job.total_rows, duplicateMode: job.duplicate_mode }
    });
    res.status(201).json(importService.publicJob(job));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const job = await importService.getJob(companyIdOf(req), Number(req.params.id));
    if (!job) {
      next(new HttpError(404, "Import niet gevonden"));
      return;
    }
    res.json(importService.publicJob(job, { includeErrors: true }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/rows", validateBody(importRowsSchema), async (req, res, next) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId)) {
      next(new HttpError(404, "Import niet gevonden"));
      return;
    }
    res.json(
      await importService.processRows({
        companyId: companyIdOf(req),
        userId: req.user.id,
        jobId,
        rows: req.body.rows
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post("/:id/finish", validateBody(finishImportSchema), async (req, res, next) => {
  try {
    const job = await importService.finishJob({
      companyId: companyIdOf(req),
      jobId: Number(req.params.id),
      cancelled: Boolean(req.body.cancelled)
    });
    if (!job) {
      next(new HttpError(404, "Import niet gevonden of al afgerond"));
      return;
    }
    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "import_finished",
      entityType: "ImportJob",
      entityId: job.id,
      metadata: {
        status: job.status,
        created: job.created_count,
        updated: job.updated_count,
        skipped: job.skipped_count,
        errors: job.error_count
      }
    });
    res.json(job);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
