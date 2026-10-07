const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { qrQuerySchema, qrByIdsSchema } = require("../schemas/bulk.schema");
const insights = require("../repositories/productInsights.repository");
const { getPassportUrl } = require("../utils/baseUrl");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// QR-beheer van het eigen bedrijf. De QR-URL wordt hier (server-side) bepaald met
// dezelfde functie als de losse PNG/SVG/PDF-downloads: één bron van waarheid, dus
// een bulk-download levert exact dezelfde codes als de al geprinte.
router.use(requireAuth, requireRole("company_admin", "company_user"));

function companyIdOf(req) {
  if (req.user.companyId == null) throw new HttpError(403, "Geen toegang");
  return req.user.companyId;
}

function withQrUrl(req, item) {
  return { ...item, qr_url: item.public_id ? getPassportUrl(req, item.public_id) : null };
}

router.get("/stats", async (req, res, next) => {
  try {
    res.json(await insights.getQrStats(companyIdOf(req)));
  } catch (error) {
    next(error);
  }
});

router.get("/", validateQuery(qrQuerySchema), async (req, res, next) => {
  try {
    const result = await insights.listQrItems({ companyId: companyIdOf(req), ...req.validatedQuery });
    res.json({ ...result, items: result.items.map((item) => withQrUrl(req, item)) });
  } catch (error) {
    next(error);
  }
});

// Gegevens voor bulk-ZIP/PDF van een expliciete selectie (max. 1000).
router.post("/items", validateBody(qrByIdsSchema), async (req, res, next) => {
  try {
    const result = await insights.listQrItems({
      companyId: companyIdOf(req),
      ids: req.body.ids,
      qrStatus: undefined,
      page: 1,
      pageSize: req.body.ids.length
    });
    res.json({ items: result.items.map((item) => withQrUrl(req, item)) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
