const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createCompanySchema, updateCompanySchema } = require("../schemas/companies.schema");
const { createInviteSchema } = require("../schemas/invites.schema");
const companiesRepo = require("../repositories/companies.repository");
const invitesRepo = require("../repositories/invites.repository");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { getAppBaseUrl, getPassportUrl } = require("../utils/baseUrl");
const { queryOne } = require("../config/db");
const { getExtendedUsage } = require("../services/license.service");
const auditLogsRepo = require("../repositories/auditLogs.repository");
const documentsRepo = require("../repositories/documents.repository");
const insights = require("../repositories/productInsights.repository");

const router = express.Router();

router.use(requireAuth, requireRole(...require("../utils/roles").PLATFORM_OWNER_ROLES));

router.get("/", async (req, res, next) => {
  try {
    res.json(await companiesRepo.listCompaniesWithStats());
  } catch (error) {
    next(error);
  }
});

// Een klant kan aan een partner gekoppeld worden; het doelbedrijf moet dan echt
// een partner zijn. Partners zelf hebben nooit een partner.
async function assertValidPartnerLink({ kind, partnerId }, next) {
  if (partnerId == null) return true;
  if (kind === "partner") {
    next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { partnerId: ["Een partner kan niet zelf aan een partner gekoppeld worden"] } }));
    return false;
  }
  const partner = await companiesRepo.getCompanyById(partnerId);
  if (!partner || partner.kind !== "partner") {
    next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { partnerId: ["Gekozen partner bestaat niet of is geen partner"] } }));
    return false;
  }
  return true;
}

router.post("/", validateBody(createCompanySchema), async (req, res, next) => {
  try {
    if (!(await assertValidPartnerLink(req.body, next))) return;
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
    if (error.code === "23505") {
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

// --- Customer 360 (alleen Platform Owner; router is al owner-only) ----------------

async function loadCompany(req, next) {
  const company = await companiesRepo.getCompanyById(Number(req.params.id));
  if (!company) next(new HttpError(404, "Niet gevonden"));
  return company;
}

router.get("/:id/overview", async (req, res, next) => {
  try {
    const company = await loadCompany(req, next);
    if (!company) return;
    const [usage, counts, partner, recent] = await Promise.all([
      getExtendedUsage(company.id),
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM products WHERE company_id = $1 AND status <> 'archived')::int AS products,
           (SELECT COUNT(*) FROM products WHERE company_id = $1 AND status = 'published')::int AS published,
           (SELECT COUNT(*) FROM products WHERE company_id = $1 AND status = 'draft')::int AS drafts,
           (SELECT COUNT(*) FROM products WHERE company_id = $1 AND public_id IS NOT NULL AND status = 'published')::int AS qr_active,
           (SELECT COUNT(*) FROM products WHERE company_id = $1 AND public_id IS NOT NULL AND status = 'draft')::int AS qr_reserved,
           (SELECT COUNT(*) FROM users WHERE company_id = $1 AND status = 'active')::int AS users_active,
           (SELECT COUNT(*) FROM users WHERE company_id = $1 AND status <> 'deleted')::int AS users_total,
           (SELECT COUNT(*) FROM documents WHERE company_id = $1 AND archived_at IS NULL)::int AS documents,
           (SELECT COUNT(*) FROM documents WHERE company_id = $1 AND archived_at IS NULL AND valid_until < CURRENT_DATE)::int AS documents_expired,
           (SELECT COUNT(*) FROM scan_events s JOIN products p ON p.id = s.product_id WHERE p.company_id = $1)::int AS scans_total,
           (SELECT COUNT(*) FROM scan_events s JOIN products p ON p.id = s.product_id
             WHERE p.company_id = $1 AND s.scanned_at >= now() - interval '30 days')::int AS scans_30d,
           (SELECT MAX(timestamp) FROM audit_logs WHERE company_id = $1) AS last_activity,
           (SELECT MAX(u.last_login_at) FROM users u WHERE u.company_id = $1) AS last_login`,
        [company.id]
      ),
      company.partner_id ? companiesRepo.getCompanyById(company.partner_id) : null,
      auditLogsRepo.listAuditLogs({ companyId: company.id, page: 1, pageSize: 8 })
    ]);
    res.json({
      company: { ...company, partner_name: partner?.name ?? null },
      usage,
      counts,
      recentActivity: recent.items ?? recent
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/documents", async (req, res, next) => {
  try {
    const company = await loadCompany(req, next);
    if (!company) return;
    res.json(await documentsRepo.listDocumentsForCompany(company.id));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/qr", async (req, res, next) => {
  try {
    const company = await loadCompany(req, next);
    if (!company) return;
    const result = await insights.listQrItems({ companyId: company.id, sort: "scans", page: 1, pageSize: 100 });
    res.json({
      ...result,
      items: result.items.map((item) => ({ ...item, qr_url: item.public_id ? getPassportUrl(req, item.public_id) : null }))
    });
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

    if (req.body.partnerId !== undefined && !(await assertValidPartnerLink({ kind: existing.kind, partnerId: req.body.partnerId }, next))) {
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
    if (error.code === "23505") {
      next(new HttpError(409, "Slug is al in gebruik"));
      return;
    }
    next(error);
  }
});

router.get("/:id/invites", async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const company = await companiesRepo.getCompanyById(companyId);
    if (!company) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(await invitesRepo.listInvitesForCompany(companyId));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/invites", validateBody(createInviteSchema), async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const company = await companiesRepo.getCompanyById(companyId);
    if (!company) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    // De invite-flow levert een company_admin op; partnerbedrijven krijgen hun
    // Partner Admins direct via de Platform Owner (gebruikersbeheer), niet via invites.
    if (company.kind === "partner") {
      next(new HttpError(409, "Partnerbedrijven krijgen geen Company Admin-uitnodigingen; maak een Partner Admin aan via Gebruikers"));
      return;
    }

    const { invite, token } = await invitesRepo.createInvite({
      companyId,
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      invitedBy: req.user.id
    });

    await logAudit({
      companyId,
      userId: req.user.id,
      action: "invite_created",
      entityType: "CompanyAdminInvite",
      entityId: invite.id
    });

    // Token zit alleen in dít antwoord — wordt nergens anders (log, DB) in plaintext bewaard.
    const activationUrl = `${getAppBaseUrl(req)}/activate?token=${token}`;
    res.status(201).json({ ...invite, activationUrl });
  } catch (error) {
    if (error.code === "23505") {
      next(new HttpError(409, "Er is al een openstaande uitnodiging voor dit e-mailadres"));
      return;
    }
    next(error);
  }
});

router.post("/:id/invites/:inviteId/revoke", async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    const invite = await invitesRepo.getInviteById(Number(req.params.inviteId));
    if (!invite || invite.company_id !== companyId) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    const revoked = await invitesRepo.revokeInvite(invite.id);
    if (!revoked) {
      next(new HttpError(409, "Uitnodiging is al gebruikt of ingetrokken"));
      return;
    }

    await logAudit({
      companyId,
      userId: req.user.id,
      action: "invite_revoked",
      entityType: "CompanyAdminInvite",
      entityId: invite.id
    });

    res.json(revoked);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
