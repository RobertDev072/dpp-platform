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
const identity = require("../services/identity.service");

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
      // De nieuwe beheerder kiest bij activatie direct zijn eigen wachtwoord: de
      // eenmalige activatielink is zelf het bewijs, er is geen e-mail nodig (VeriPasso
      // verstuurt bewust geen mail; de link wordt handmatig gedeeld).
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
      next(
        new HttpError(400, "Ongeldige invoer", {
          formErrors: [],
          fieldErrors: { password: ["Kies een wachtwoord van minimaal 12 tekens"] }
        })
      );
      return;
    }

    let passwordHash = null;
    let authUserId = null;

    if (identity.isIdentityProviderConfigured()) {
      const displayName = [invite.first_name, invite.last_name].filter(Boolean).join(" ") || invite.email;
      try {
        ({ authUserId } = await identity.createAuthUser({
          email: invite.email,
          displayName,
          password: req.body.password
        }));
      } catch (error) {
        if (error instanceof identity.IdentityError && error.code === "EMAIL_EXISTS") {
          next(new HttpError(409, "Er bestaat al een account met dit e-mailadres"));
          return;
        }
        if (error instanceof identity.IdentityError && error.code === "WEAK_PASSWORD") {
          next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { password: [error.message] } }));
          return;
        }
        throw error;
      }
    } else {
      // Lokale modus (zonder Supabase Auth, alleen lokaal/tests): bcrypt-account.
      passwordHash = await hashPassword(req.body.password);
    }

    let created;
    try {
      created = await usersRepo.createUserWithSeatLimit({
        companyId: invite.company_id,
        maxUsers,
        email: invite.email,
        passwordHash,
        authUserId,
        firstName: invite.first_name,
        lastName: invite.last_name,
        role: "company_admin",
        status: "active"
      });
    } catch (error) {
      if (authUserId) await identity.deleteAuthUser(authUserId).catch(() => {});
      throw error;
    }
    const { limitReached, user } = created;

    if (limitReached) {
      if (authUserId) await identity.deleteAuthUser(authUserId).catch(() => {});
      next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
      return;
    }

    const accepted = await invitesRepo.markInviteAccepted(invite.id);
    if (!accepted) {
      // Race: een andere gelijktijdige request won de one-time-use-guard. In de
      // praktijk faalt de verliezer al eerder op het unieke e-mailadres; dit is de
      // laatste vangrail.
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

    // Het wachtwoord is bij activatie gekozen: de beheerder kan direct inloggen.
    res.status(201).json({ email: user.email, mustSetPassword: false });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
