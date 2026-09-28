const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createCompanySchema, updateCompanySchema } = require("../schemas/companies.schema");
const { createInviteSchema } = require("../schemas/invites.schema");
const companiesRepo = require("../repositories/companies.repository");
const invitesRepo = require("../repositories/invites.repository");
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
    const activationUrl = `${req.protocol}://${req.get("host")}/activate?token=${token}`;
    res.status(201).json({ ...invite, activationUrl });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
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
