const express = require("express");
const { z } = require("zod");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/permissions");
const auditRepo = require("../repositories/audit.repository");
const { parseOptionalId } = require("../utils/params");
const { HttpError } = require("../middleware/errorHandler");

// Platformbrede audit log (System Owner). De company-eigen audit log zit in
// company.routes.js (GET /api/company/audit) met de tenant-scope uit de sessie.
const router = express.Router();

router.use(requireAuth, requirePermission(PERMISSIONS.PLATFORM_AUDIT));

const MAX_LIMIT = 200;

// Een leeg queryveld (?action=) betekent "geen filter".
const emptyToUndefined = (value) => (value === "" ? undefined : value);

const auditQuerySchema = z.object({
  companyId: z.string().optional(),
  action: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100).optional()),
  entityType: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(50).optional()),
  // Te grote limit wordt afgekapt in plaats van geweigerd: een bladerende UI hoeft de
  // exacte grens dan niet te kennen.
  limit: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int()
      .min(1)
      .default(50)
      .transform((value) => Math.min(value, MAX_LIMIT))
  ),
  offset: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(2147483647).default(0))
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new HttpError(400, "Ongeldige invoer", parsed.error.flatten()));
      return;
    }

    const { companyId, action, entityType, limit, offset } = parsed.data;
    res.json(
      await auditRepo.listAuditLogs({
        companyId: parseOptionalId(companyId),
        action,
        entityType,
        limit,
        offset
      })
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
