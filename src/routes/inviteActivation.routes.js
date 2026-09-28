const express = require("express");
const { validateBody } = require("../middleware/validate");
const { acceptInviteSchema } = require("../schemas/invites.schema");
const invitesRepo = require("../repositories/invites.repository");
const companiesRepo = require("../repositories/companies.repository");
const usersRepo = require("../repositories/users.repository");
const plansRepo = require("../repositories/plans.repository");
const { hashPassword } = require("../utils/password");
const { generateTempPassword } = require("../utils/tempPassword");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { isEntraConfigured } = require("../config/entra");
const graphClient = require("../services/graphClient");

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
      requiresPassword: !isEntraConfigured()
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

    const maxUsers = await plansRepo.getMaxUsersForCompany(invite.company_id);

    let passwordHash = null;
    let entraObjectId = null;

    if (isEntraConfigured()) {
      const tempPassword = generateTempPassword();
      const displayName = [invite.first_name, invite.last_name].filter(Boolean).join(" ") || invite.email;
      const created = await graphClient.createEntraUser({
        email: invite.email,
        displayName,
        tempPassword
      });
      entraObjectId = created.entraObjectId;
    } else {
      if (!req.body.password) {
        next(new HttpError(400, "password is verplicht zolang Entra niet is geconfigureerd"));
        return;
      }
      passwordHash = await hashPassword(req.body.password);
    }

    const { limitReached, user } = await usersRepo.createUserWithSeatLimit({
      companyId: invite.company_id,
      maxUsers,
      email: invite.email,
      passwordHash,
      entraObjectId,
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

    // Bij Entra-provisioning heeft de gebruiker nog geen bruikbaar wachtwoord (het
    // Graph-aanroep vereist er wel één, maar die wordt nooit getoond of gedeeld) -
    // stuur de frontend expliciet door naar de wachtwoord-instellen-flow i.p.v. direct
    // naar /login, waar hij anders vast zou lopen.
    res.status(201).json({ email: user.email, mustSetPassword: entraObjectId !== null });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
