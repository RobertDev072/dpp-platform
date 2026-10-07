const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { printProfileSchema, updatePrintProfileSchema } = require("../schemas/printProfiles.schema");
const { checkSettings, exampleProfiles } = require("../services/printLayout");
const { query, queryRows, queryOne, withTransaction } = require("../config/db");
const { logAuditFromReq } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// Printprofielen zijn per bedrijf. Iedereen van het bedrijf mag ze gebruiken
// (labels printen); alleen de Bedrijfsbeheerder mag ze beheren.
router.use(requireAuth, requireRole("company_admin", "company_user"));
const requireAdmin = requireRole("company_admin");

const MAX_PROFILES = 50;

function companyIdOf(req) {
  if (req.user.companyId == null) throw new HttpError(403, "Geen toegang");
  return req.user.companyId;
}

function toApi(row) {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    isDefault: row.is_default,
    settings: JSON.parse(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function assertUsable(settings) {
  const { errors, warnings } = checkSettings(settings);
  if (errors.length) {
    throw new HttpError(400, errors[0], { formErrors: errors, fieldErrors: {} }, "PRINT_SETTINGS_INVALID");
  }
  return warnings;
}

async function loadOwn(req, next) {
  const id = Number(req.params.id);
  const row = Number.isInteger(id)
    ? await queryOne("SELECT * FROM print_profiles WHERE id = $1 AND company_id = $2", [id, companyIdOf(req)])
    : null;
  if (!row) next(new HttpError(404, "Printprofiel niet gevonden"));
  return row;
}

router.get("/", async (req, res, next) => {
  try {
    const rows = await queryRows(
      "SELECT * FROM print_profiles WHERE company_id = $1 ORDER BY is_default DESC, name ASC",
      [companyIdOf(req)]
    );
    res.json({ items: rows.map(toApi), examples: exampleProfiles() });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const row = await loadOwn(req, next);
    if (row) res.json(toApi(row));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAdmin, validateBody(printProfileSchema), async (req, res, next) => {
  try {
    const companyId = companyIdOf(req);
    const warnings = assertUsable(req.body.settings);
    const created = await withTransaction(async (client) => {
      const count = (await client.query("SELECT COUNT(*) AS n FROM print_profiles WHERE company_id = $1", [companyId])).rows[0].n;
      if (count >= MAX_PROFILES) throw new HttpError(409, `Maximaal ${MAX_PROFILES} printprofielen per bedrijf`);
      // Het eerste profiel wordt automatisch de standaard.
      const makeDefault = Boolean(req.body.isDefault) || count === 0;
      if (makeDefault) await client.query("UPDATE print_profiles SET is_default = FALSE WHERE company_id = $1", [companyId]);
      return (
        await client.query(
          `INSERT INTO print_profiles (company_id, name, purpose, settings, is_default, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [companyId, req.body.name, req.body.purpose || null, JSON.stringify(req.body.settings), makeDefault, req.user.id]
        )
      ).rows[0];
    });
    await logAuditFromReq(req, { companyId, action: "create", entityType: "PrintProfile", entityId: created.id });
    res.status(201).json({ ...toApi(created), warnings });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAdmin, validateBody(updatePrintProfileSchema), async (req, res, next) => {
  try {
    const existing = await loadOwn(req, next);
    if (!existing) return;
    const settings = req.body.settings || JSON.parse(existing.settings);
    const warnings = assertUsable(settings);
    const updated = await withTransaction(async (client) => {
      if (req.body.isDefault) {
        await client.query("UPDATE print_profiles SET is_default = FALSE WHERE company_id = $1", [existing.company_id]);
      }
      return (
        await client.query(
          `UPDATE print_profiles SET name = $3, purpose = $4, settings = $5,
             is_default = $6, updated_at = now()
           WHERE id = $1 AND company_id = $2 RETURNING *`,
          [
            existing.id,
            existing.company_id,
            req.body.name ?? existing.name,
            req.body.purpose !== undefined ? req.body.purpose || null : existing.purpose,
            JSON.stringify(settings),
            req.body.isDefault ? true : existing.is_default
          ]
        )
      ).rows[0];
    });
    await logAuditFromReq(req, { companyId: existing.company_id, action: "update", entityType: "PrintProfile", entityId: existing.id });
    res.json({ ...toApi(updated), warnings });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const existing = await loadOwn(req, next);
    if (!existing) return;
    await withTransaction(async (client) => {
      await client.query("DELETE FROM print_profiles WHERE id = $1 AND company_id = $2", [existing.id, existing.company_id]);
      if (existing.is_default) {
        // Een ander profiel (het oudste) wordt de nieuwe standaard.
        await client.query(
          `UPDATE print_profiles SET is_default = TRUE
           WHERE id = (SELECT id FROM print_profiles WHERE company_id = $1 ORDER BY created_at LIMIT 1)`,
          [existing.company_id]
        );
      }
    });
    await logAuditFromReq(req, { companyId: existing.company_id, action: "delete", entityType: "PrintProfile", entityId: existing.id });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
