const express = require("express");
const { z } = require("zod");
const { zipSync } = require("fflate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const printProfilesRepo = require("../repositories/printProfiles.repository");
const productsRepo = require("../repositories/products.repository");
const companiesRepo = require("../repositories/companies.repository");
const printLayout = require("../services/printLayout.service");
const { generateQrPngBuffer, generateQrSvgString } = require("../services/qrCode.service");
const { getPassportUrl } = require("../utils/baseUrl");
const { logAuditFromReq } = require("../utils/auditLog");
const { heavyWorkLimiter } = require("../middleware/rateLimit");

// Print & labels: printprofielen (per bedrijf), preview, label-PDF's en QR-ZIP's.
// Alles is tenant-gebonden via req.user.companyId; product-id's van een ander bedrijf
// worden door de repository genegeerd.
const router = express.Router();
const COMPANY_ROLES = ["company_admin", "company_user"];

// Per PDF/ZIP maximaal 500 producten: houdt de response onder de ~4,5 MB van Vercel
// en de verwerking ruim binnen 30 s. Grotere selecties vraagt de client in delen op.
const MAX_LABELS_PER_PDF = 500;
const MAX_QR_PER_ZIP = { png: 500, svg: 2000 };

router.use(requireAuth, requireRole(...COMPANY_ROLES), (req, res, next) => {
  if (req.user.companyId == null) {
    next(new HttpError(404, "Niet gevonden"));
    return;
  }
  next();
});

const SAMPLE_PUBLIC_ID = "0F8FAD5B-D9CB-469F-A165-70867728950E";

function sampleUrl(req) {
  return getPassportUrl(req, SAMPLE_PUBLIC_ID);
}

const settingsSourceSchema = z.object({
  profileId: z.number().int().positive().optional(),
  presetKey: z.string().max(40).optional(),
  settings: z.unknown().optional()
});

// Instellingen uit een opgeslagen profiel, een ingebouwde preset of (bij de editor)
// rechtstreeks meegestuurd. Altijd door het Zod-schema.
async function resolveSettings(req, source) {
  if (source.profileId) {
    const profile = await printProfilesRepo.getProfile(source.profileId, req.user.companyId);
    if (!profile) throw new HttpError(404, "Printprofiel niet gevonden");
    return { settings: printLayout.resolveSettings(profile.settings), name: profile.name };
  }
  if (source.presetKey) {
    const preset = printLayout.BUILT_IN_PRESETS.find((p) => p.key === source.presetKey);
    if (!preset) throw new HttpError(404, "Printprofiel niet gevonden");
    return { settings: printLayout.resolveSettings(preset.settings), name: preset.name };
  }
  const parsed = printLayout.printSettingsSchema.safeParse(source.settings ?? {});
  if (!parsed.success) throw new HttpError(400, "Ongeldige printinstellingen", parsed.error.flatten());
  return { settings: parsed.data, name: "Aangepast" };
}

router.get("/options", (req, res) => {
  res.json({
    paperSizes: printLayout.PAPER_SIZES,
    layouts: printLayout.LABEL_LAYOUTS,
    templates: printLayout.TEMPLATES,
    templateElements: printLayout.TEMPLATE_ELEMENTS,
    elementKeys: printLayout.ELEMENT_KEYS,
    presets: printLayout.BUILT_IN_PRESETS.map((p) => ({ ...p, settings: printLayout.resolveSettings(p.settings) })),
    limits: { labelsPerPdf: MAX_LABELS_PER_PDF, qrPerZip: MAX_QR_PER_ZIP }
  });
});

router.get("/profiles", async (req, res, next) => {
  try {
    const profiles = await printProfilesRepo.listProfiles(req.user.companyId);
    res.json(
      profiles.map((profile) => {
        const settings = printLayout.resolveSettings(profile.settings);
        return { ...profile, settings, summary: printLayout.summarize(settings, 0, sampleUrl(req)) };
      })
    );
  } catch (error) {
    next(error);
  }
});

const MAX_PROFILES = 50;

// Profielen beheren is bedrijfsinstelling: alleen de Bedrijfsbeheerder.
router.post("/profiles", requireRole("company_admin"), validateBody(printLayout.printProfileSchema), async (req, res, next) => {
  try {
    if ((await printProfilesRepo.countProfiles(req.user.companyId)) >= MAX_PROFILES) {
      throw new HttpError(409, `Maximaal ${MAX_PROFILES} printprofielen per bedrijf.`);
    }
    const profile = await printProfilesRepo.saveProfile({
      companyId: req.user.companyId,
      createdBy: req.user.id,
      ...req.body
    });
    await logAuditFromReq(req, { companyId: req.user.companyId, action: "create", entityType: "PrintProfile", entityId: profile.id });
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

router.put("/profiles/:id", requireRole("company_admin"), validateBody(printLayout.printProfileSchema), async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const existing = Number.isInteger(id) ? await printProfilesRepo.getProfile(id, req.user.companyId) : null;
    if (!existing) throw new HttpError(404, "Niet gevonden");
    const profile = await printProfilesRepo.saveProfile({ id, companyId: req.user.companyId, ...req.body });
    await logAuditFromReq(req, { companyId: req.user.companyId, action: "update", entityType: "PrintProfile", entityId: id });
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.delete("/profiles/:id", requireRole("company_admin"), async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const deleted = Number.isInteger(id) ? await printProfilesRepo.deleteProfile(id, req.user.companyId) : null;
    if (!deleted) throw new HttpError(404, "Niet gevonden");
    await logAuditFromReq(req, { companyId: req.user.companyId, action: "delete", entityType: "PrintProfile", entityId: id });
    res.json(deleted);
  } catch (error) {
    next(error);
  }
});

// Samenvatting voor de preview: labels per pagina, aantal pagina's, QR-blokgrootte,
// waarschuwingen en blokkerende fouten.
router.post(
  "/summary",
  validateBody(settingsSourceSchema.extend({ productCount: z.number().int().min(0).max(1000000).default(1) })),
  async (req, res, next) => {
    try {
      const { settings, name } = await resolveSettings(req, req.body);
      res.json({ name, settings, ...printLayout.summarize(settings, req.body.productCount, sampleUrl(req)) });
    } catch (error) {
      next(error);
    }
  }
);

const SAMPLE_PRODUCT = {
  name: "Voorbeeldproduct Oslo",
  sku: "HB-OSLO-01",
  gtin: "8712345678906",
  category_label: "Banken",
  manufacturer: "Voorbeeldfabriek BV",
  country_of_origin: "Nederland",
  ce_marked: true,
  recyclable: true,
  public_id: SAMPLE_PUBLIC_ID
};

// Eén pagina voorbeeld-PDF. Met productIds de eerste echte producten (van het eigen
// bedrijf), anders een voorbeeldproduct dat de pagina vult.
router.post(
  "/preview.pdf",
  validateBody(settingsSourceSchema.extend({ productIds: z.array(z.number().int().positive()).max(100).optional() })),
  async (req, res, next) => {
    try {
      const { settings } = await resolveSettings(req, req.body);
      const layout = printLayout.computeLayout(settings);
      if (!(layout.cellW > 0 && layout.cellH > 0)) {
        throw new HttpError(400, "De marges en tussenruimte zijn groter dan het papier.");
      }
      let products = [];
      if (req.body.productIds?.length) {
        products = (await productsRepo.getProductsForOutput(req.user.companyId, req.body.productIds.slice(0, layout.perPage)))
          .map((p) => ({ ...p, public_id: p.public_id || SAMPLE_PUBLIC_ID }));
      }
      if (!products.length) {
        products = Array.from({ length: Math.min(layout.perPage, 40) }, () => SAMPLE_PRODUCT);
      }
      const company = await companiesRepo.getCompanyById(req.user.companyId);
      const pdf = await printLayout.renderLabelsPdf({
        products,
        settings,
        companyLogo: company?.logo,
        urlFor: (p) => getPassportUrl(req, p.public_id),
        title: "Voorbeeld"
      });
      res.set("Content-Type", "application/pdf");
      res.set("Cache-Control", "no-store");
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  }
);

const labelsSchema = settingsSourceSchema.extend({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_LABELS_PER_PDF),
  // Producten zonder QR-code: eerst een QR-code reserveren (niet publiceren).
  generateMissing: z.boolean().default(false),
  part: z.number().int().min(1).max(1000).optional()
});

router.post("/labels.pdf", heavyWorkLimiter, validateBody(labelsSchema), async (req, res, next) => {
  try {
    const { settings } = await resolveSettings(req, req.body);
    const check = printLayout.checkReadability(settings, sampleUrl(req));
    if (check.errors.length) {
      throw new HttpError(400, check.errors[0], { formErrors: check.errors, fieldErrors: {} }, "PRINT_UNREADABLE");
    }

    const ids = [...new Set(req.body.ids)];
    if (req.body.generateMissing) {
      await productsRepo.bulkReserveQr(req.user.companyId, ids);
    }
    const products = (await productsRepo.getProductsForOutput(req.user.companyId, ids)).filter((p) => p.public_id);
    if (!products.length) {
      throw new HttpError(400, "Geen van de geselecteerde producten heeft een QR-code. Genereer eerst QR-codes.");
    }

    const company = await companiesRepo.getCompanyById(req.user.companyId);
    const pdf = await printLayout.renderLabelsPdf({
      products,
      settings,
      companyLogo: company?.logo,
      urlFor: (p) => getPassportUrl(req, p.public_id),
      title: "VeriPasso labels"
    });

    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "print_labels",
      entityType: "Product",
      metadata: { count: products.length, skipped: ids.length - products.length, profileId: req.body.profileId ?? null }
    });

    const suffix = req.body.part ? `-${String(req.body.part).padStart(3, "0")}` : "";
    res.set("Content-Type", "application/pdf");
    res.set("X-Labels-Count", String(products.length));
    res.set("X-Labels-Skipped", String(ids.length - products.length));
    res.attachment(`labels${suffix}.pdf`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

const zipSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_QR_PER_ZIP.svg),
  format: z.enum(["png", "svg"]).default("png"),
  // 1200 px ≈ 10 cm op 300 DPI.
  sizePx: z.number().int().min(256).max(2400).default(1200),
  generateMissing: z.boolean().default(false),
  part: z.number().int().min(1).max(1000).optional()
});

router.post("/qr.zip", heavyWorkLimiter, validateBody(zipSchema), async (req, res, next) => {
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
      files[`qr-${stem}.${format}`] =
        format === "svg"
          ? Buffer.from(await generateQrSvgString(url))
          : await generateQrPngBuffer(url, { width: sizePx });
    }
    // PNG is al gecomprimeerd; SVG comprimeert goed.
    const zip = zipSync(files, { level: format === "svg" ? 6 : 0 });

    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "export_qr",
      entityType: "Product",
      metadata: { count: products.length, format }
    });

    const suffix = req.body.part ? `-${String(req.body.part).padStart(3, "0")}` : "";
    res.set("Content-Type", "application/zip");
    res.set("X-Files-Count", String(products.length));
    res.attachment(`qr-codes-${format}${suffix}.zip`);
    res.send(Buffer.from(zip));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
