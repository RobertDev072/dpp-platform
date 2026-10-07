const express = require("express");
const { validateBody } = require("../middleware/validate");
const { acceptInviteSchema } = require("../schemas/invites.schema");
const invitesRepo = require("../repositories/invites.repository");
const companiesRepo = require("../repositories/companies.repository");
const usersRepo = require("../repositories/users.repository");
const plansRepo = require("../repositories/plans.repository");
const { hashPassword } = require("../utils/password");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

function isInviteUsable(invite) {
  return invite && invite.status === "pending" && new Date(invite.expires_at) >= new Date();
}

router.get("/:token", async (req, res, next) => {
  try {
    const invite = await invitesRepo.getInviteByToken(req.params.token);
    if (!invite) {
      next(new HttpError(404, "Uitnodiging niet gevonden"));
      return;
    }
    if (!isInviteUsable(invite)) {
      next(new HttpError(410, "Deze uitnodiging is niet meer geldig"));
      return;
    }

    const company = await companiesRepo.getCompanyById(invite.company_id);

    res.json({
      email: invite.email,
      companyName: company ? company.name : null,
      // De nieuwe beheerder kiest bij activatie direct een eigen wachtwoord.
      requiresPassword: true
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:token/accept", validateBody(acceptInviteSchema), async (req, res, next) => {
  try {
    const invite = await invitesRepo.getInviteByToken(req.params.token);
    if (!invite) {
      next(new HttpError(404, "Uitnodiging niet gevonden"));
      return;
    }
    if (!isInviteUsable(invite)) {
      next(new HttpError(410, "Deze uitnodiging is niet meer geldig"));
      return;
    }

    // Verlopen licentie of volle seat-limiet blokkeert ook activatie via uitnodiging.
    await require("../services/license.service").assertCanCreate(invite.company_id, "user");

    const maxUsers = await plansRepo.getMaxUsersForCompany(invite.company_id);

    if (!req.body.password) {
      next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { password: ["Kies een wachtwoord"] } }));
      return;
    }
    const passwordHash = await hashPassword(req.body.password);

    const { limitReached, user } = await usersRepo.createUserWithSeatLimit({
      companyId: invite.company_id,
      maxUsers,
      email: invite.email,
      passwordHash,
      firstName: invite.first_name,
      lastName: invite.last_name,
      role: "company_admin",
      status: "active"
    });

    if (limitReached) {
      next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
      return;
    }

    const accepted = await invitesRepo.markInviteAccepted(invite.id);
    if (!accepted) {
      // Race: een andere gelijktijdige request won de one-time-use-guard. De hierboven
      // aangemaakte identity blijft dan als ongebruikt account achter (zelfde bekende
      // MVP-beperking als bij de race in users.routes.js).
      next(new HttpError(409, "Deze uitnodiging is net door een andere aanvraag geactiveerd"));
      return;
    }

    await logAudit({
      companyId: invite.company_id,
      userId: user.id,
      action: "invite_activation",
      entityType: "User",
      entityId: user.id
    });

    res.status(201).json({ email: user.email, mustSetPassword: false });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
