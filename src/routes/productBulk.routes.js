const express = require("express");
const { z } = require("zod");
const XLSX = require("xlsx");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const productsRepo = require("../repositories/products.repository");
const { productSelectionSchema } = require("../schemas/productsQuery.schema");
const { getPassportUrl } = require("../utils/baseUrl");
const { logAuditFromReq } = require("../utils/auditLog");
const { heavyWorkLimiter } = require("../middleware/rateLimit");

// Bulkacties op producten van het eigen bedrijf. De selectie is óf een lijst id's óf
// een filter; beide worden server-side tegen req.user.companyId opgelost, dus id's of
// filters kunnen nooit producten van een ander bedrijf raken.
const router = express.Router();
const COMPANY_ROLES = ["company_admin", "company_user"];
const MAX_SELECTION = 10000;

router.use(requireAuth, requireRole(...COMPANY_ROLES), (req, res, next) => {
  if (req.user.companyId == null) {
    next(new HttpError(404, "Niet gevonden"));
    return;
  }
  next();
});

async function resolveSelection(req, selection) {
  const ids = await productsRepo.listProductIds({
    companyId: req.user.companyId,
    ids: selection.ids,
    filters: selection.filter || {},
    limit: MAX_SELECTION
  });
  return ids;
}

// Selectie → id's (de client vraagt PDF's/ZIP's daarna in delen op).
router.post("/resolve", validateBody(z.object({ selection: productSelectionSchema })), async (req, res, next) => {
  try {
    const ids = await resolveSelection(req, req.body.selection);
    res.json({ ids, count: ids.length, limit: MAX_SELECTION });
  } catch (error) {
    next(error);
  }
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), selection: productSelectionSchema, includeIncomplete: z.boolean().default(false) }),
  z.object({ action: z.literal("archive"), selection: productSelectionSchema }),
  z.object({ action: z.literal("generate_qr"), selection: productSelectionSchema }),
  z.object({ action: z.literal("set_category"), selection: productSelectionSchema, category: z.string().trim().max(100) })
]);

router.post("/actions", validateBody(actionSchema), async (req, res, next) => {
  try {
    const ids = await resolveSelection(req, req.body.selection);
    const companyId = req.user.companyId;
    let affected = [];
    switch (req.body.action) {
      case "publish":
        // Standaard alleen complete producten: publiceren is een bewuste stap, en
        // een bulkactie mag geen half paspoort openbaar maken.
        affected = await productsRepo.bulkPublish(companyId, ids, { onlyComplete: !req.body.includeIncomplete });
        break;
      case "archive":
        affected = await productsRepo.bulkArchive(companyId, ids);
        break;
      case "generate_qr":
        affected = await productsRepo.bulkReserveQr(companyId, ids);
        break;
      case "set_category":
        affected = await productsRepo.bulkSetCategory(companyId, ids, req.body.category);
        break;
      default:
        throw new HttpError(400, "Onbekende actie");
    }

    // Compliance: gewijzigde paspoorten die op de markt zijn archiveren (EN 18221 §4.2).
    if (req.body.action !== "generate_qr") {
      await require("../services/passportArchive.service").archiveSafely(affected, {
        userId: req.user.id,
        reason: `bulk_${req.body.action}`
      });
    }

    await logAuditFromReq(req, {
      companyId,
      action: `bulk_${req.body.action}`,
      entityType: "Product",
      metadata: { requested: ids.length, affected: affected.length, ids: affected.slice(0, 200) }
    });

    res.json({ action: req.body.action, requested: ids.length, affected: affected.length, skipped: ids.length - affected.length });
  } catch (error) {
    next(error);
  }
});

const STATUS_LABELS = { draft: "Concept", published: "Gepubliceerd", archived: "Gearchiveerd" };

function yesNo(value) {
  if (value == null) return "";
  return value ? "ja" : "nee";
}

function materialsText(value) {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return "";
    }
  }
  return Array.isArray(list) ? list.map((m) => (m.pct != null ? `${m.material} ${m.pct}%` : m.material)).join("; ") : "";
}

// Excel-export met dezelfde kolomnamen als het importtemplate: een export kan
// aangepast en opnieuw geïmporteerd worden ("bestaand product bijwerken").
router.post("/export", heavyWorkLimiter, validateBody(z.object({ selection: productSelectionSchema })), async (req, res, next) => {
  try {
    const ids = await resolveSelection(req, req.body.selection);
    if (!ids.length) throw new HttpError(400, "Er zijn geen producten geselecteerd.");
    const products = [];
    for (let i = 0; i < ids.length; i += 1000) {
      products.push(...(await productsRepo.getProductsForOutput(req.user.companyId, ids.slice(i, i + 1000))));
    }
    const header = [
      "product_name", "sku", "gtin", "model", "brand", "manufacturer", "category", "country_of_origin", "description",
      "material", "recycled_material_percentage", "carbon_footprint_kg", "recyclable", "reach_compliant", "rohs_compliant",
      "ce_marked", "status", "qr_url"
    ];
    const rows = products.map((p) => [
      p.name, p.sku || "", p.gtin || "", p.model || "", p.brand || "", p.manufacturer || "", p.category_label || "",
      p.country_of_origin || "", p.description || "", materialsText(p.materials), p.recycled_material_pct ?? "",
      p.co2_footprint_kg ?? "", yesNo(p.recyclable), yesNo(p.reach_conform), yesNo(p.rohs_conform), yesNo(p.ce_marked),
      STATUS_LABELS[p.status] || p.status, p.public_id ? getPassportUrl(req, p.public_id) : ""
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows.map((r) => r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v)))]);
    // SKU/GTIN als tekst, zodat Excel geen voorloopnullen of wetenschappelijke notatie maakt.
    for (let r = 1; r <= rows.length; r += 1) {
      for (const c of [1, 2]) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) {
          cell.t = "s";
          cell.v = String(cell.v);
        }
      }
    }
    sheet["!cols"] = header.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Producten");

    await logAuditFromReq(req, {
      companyId: req.user.companyId,
      action: "export_products",
      entityType: "Product",
      metadata: { count: products.length }
    });

    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.attachment(`producten-${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
