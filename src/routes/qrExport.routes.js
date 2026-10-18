const express = require("express");
const { z } = require("zod");
const { zipSync } = require("fflate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const productsRepo = require("../repositories/products.repository");
const { generateQrPngBuffer, generateQrSvgString, generateDataMatrixPngBuffer, generateDataMatrixSvgString } = require("../services/qrCode.service");
const { getPassportUrl } = require("../utils/baseUrl");
const { logAuditFromReq } = require("../utils/auditLog");
const { heavyWorkLimiter } = require("../middleware/rateLimit");

// QR-codes van meerdere producten tegelijk als ZIP (voor verpakkingsdrukwerk).
// Tenant-gebonden via req.user.companyId; id's van een ander bedrijf negeert de
// repository. Per ZIP max. 500 PNG's / 2.000 SVG's; grotere selecties vraagt de
// client in delen op.
const router = express.Router();
const COMPANY_ROLES = ["company_admin", "company_user"];
const MAX_QR_PER_ZIP = { png: 500, svg: 2000 };

router.use(requireAuth, requireRole(...COMPANY_ROLES), (req, res, next) => {
  if (req.user.companyId == null) {
    next(new HttpError(404, "Niet gevonden"));
    return;
  }
  next();
});

const zipSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_QR_PER_ZIP.svg),
  format: z.enum(["png", "svg"]).default("png"),
  // QR-code (standaard) of Data Matrix (ISO/IEC 16022) met dezelfde paspoort-URL.
  symbology: z.enum(["qr", "datamatrix"]).default("qr"),
  // 1200 px ≈ 10 cm op 300 DPI.
  sizePx: z.number().int().min(256).max(2400).default(1200),
  generateMissing: z.boolean().default(false),
  part: z.number().int().min(1).max(1000).optional()
});

router.post("/codes.zip", heavyWorkLimiter, validateBody(zipSchema), async (req, res, next) => {
  try {
    const { format, sizePx } = req.body;
    const ids = [...new Set(req.body.ids)];
    if (ids.length > MAX_QR_PER_ZIP[format]) {
      throw new HttpError(400, `Maximaal ${MAX_QR_PER_ZIP[format]} ${format.toUpperCase()}-bestanden per ZIP.`);
    }
    if (req.body.generateMissing) {
      await productsRepo.bulkReserveQr(req.user.companyId, ids);
    }
    const products = (await productsRepo.getProductsForOutput(req.user.companyId, ids)).filter((p) => p.public_id);
    if (!products.length) {
      throw new HttpError(400, "Geen van de geselecteerde producten heeft een QR-code. Genereer eerst QR-codes.");
    }

    const files = {};
    const used = new Set();
    for (const product of products) {
      // Bestandsnaam uit SKU/id, nooit uit vrije invoer met padtekens.
      let stem = (product.sku || `product-${product.id}`).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || `product-${product.id}`;
      if (used.has(stem)) stem = `${stem}-${product.id}`;
      used.add(stem);
      const url = getPassportUrl(req, product.public_id);
      const dm = req.body.symbology === "datamatrix";
      files[`${dm ? "datamatrix" : "qr"}-${stem}.${format}`] =
        format === "svg"
          ? Buffer.from(dm ? generateDataMatrixSvgString(url) : await generateQrSvgString(url))
          : dm
            ? await generateDataMatrixPngBuffer(url, { width: sizePx })
            : await generateQrPngBuffer(url, { width: sizePx });
    }
    // PNG is al gecomprimeerd; SVG comprimeert goed.
    const zip = zipSync(files, { level: format === "svg" ? 6 : 0 });

    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "export_qr",
      entityType: "Product",
      metadata: { count: products.length, format, symbology: req.body.symbology }
    });

    const suffix = req.body.part ? `-${String(req.body.part).padStart(3, "0")}` : "";
    res.set("Content-Type", "application/zip");
    res.set("X-Files-Count", String(products.length));
    res.attachment(`${req.body.symbology === "datamatrix" ? "datamatrix" : "qr"}-codes-${format}${suffix}.zip`);
    res.send(Buffer.from(zip));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
