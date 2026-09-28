const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createCompanySchema, updateCompanySchema } = require("../schemas/companies.schema");
const companiesRepo = require("../repositories/companies.repository");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth, requireRole("system_owner"));

router.get("/", async (req, res, next) => {
  try {
    res.json(await companiesRepo.listCompanies());
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createCompanySchema), async (req, res, next) => {
  try {
    const company = await companiesRepo.createCompany(req.body);

    await logAudit({
      companyId: company.id,
      userId: req.user.id,
      action: "create",
      entityType: "Company",
      entityId: company.id
    });

    res.status(201).json(company);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      next(new HttpError(409, "Slug is al in gebruik"));
      return;
    }
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const company = await companiesRepo.getCompanyById(Number(req.params.id));
    if (!company) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(company);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", validateBody(updateCompanySchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await companiesRepo.getCompanyById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const updated = await companiesRepo.updateCompany(id, req.body);

    await logAudit({
      companyId: id,
      userId: req.user.id,
      action: "update",
      entityType: "Company",
      entityId: id,
      metadata: req.body
    });

    res.json(updated);
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      next(new HttpError(409, "Slug is al in gebruik"));
      return;
    }
    next(error);
  }
});

module.exports = router;
