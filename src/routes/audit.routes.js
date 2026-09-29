const express = require("express");
const { z } = require("zod");
const { requireAuth, requirePlatformOwner, requireRole } = require("../middleware/auth");
const { validateQuery } = require("../middleware/validate");
const { listAuditQuerySchema } = require("../schemas/audit.schema");
const { assertCompanyAccess } = require("../utils/tenant");
const auditLogsRepo = require("../repositories/auditLogs.repository");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth);

const ownerAuditQuerySchema = listAuditQuerySchema.extend({
  companyId: z.coerce.number().int().positive().optional()
});

// Platform Owner: alle bedrijven, optioneel gefilterd met ?companyId=.
router.get("/", requirePlatformOwner, validateQuery(ownerAuditQuerySchema), async (req, res, next) => {
  try {
    res.json(await auditLogsRepo.listAuditLogs(req.validatedQuery));
  } catch (error) {
    next(error);
  }
});

// Company Admin: uitsluitend het eigen bedrijf (cross-tenant geeft 404).
router.get(
  "/company/:id",
  requireRole("platform_owner", "company_admin"),
  validateQuery(listAuditQuerySchema),
  async (req, res, next) => {
    try {
      const companyId = Number(req.params.id);
      if (!Number.isInteger(companyId) || companyId <= 0) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, companyId);
      res.json(await auditLogsRepo.listAuditLogs({ ...req.validatedQuery, companyId }));
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
