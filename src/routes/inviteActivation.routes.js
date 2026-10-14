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
const { loginIpLimiter } = require("../middleware/rateLimit");

// Account activeren met een activatielink (uitnodiging): 48 uur geldig, eenmalig,
// alleen de hash van het token staat in de database. De nieuwe gebruiker kiest hier
// direct een eigen wachtwoord; er bestaat dus nooit een tijdelijk wachtwoord voor dit
// account. Het token komt nooit in logs (routes worden genormaliseerd gelogd).
const router = express.Router();
router.use(loginIpLimiter);

const EXPIRED_MESSAGE =
  "Deze activatielink is verlopen (een link is 48 uur geldig). Vraag je partner of VeriPasso om een nieuwe link.";
const USED_MESSAGE = "Deze activatielink is al gebruikt of ingetrokken. Je kunt inloggen met je eigen wachtwoord, of vraag om een nieuwe link.";

function assertUsable(invite) {
  if (!invite) throw new HttpError(404, "Activatielink niet gevonden. Controleer of je de volledige link hebt gebruikt.");
  if (invite.status !== "pending") throw new HttpError(410, USED_MESSAGE, undefined, "INVITE_USED");
  if (new Date(invite.expires_at) <= new Date()) throw new HttpError(410, EXPIRED_MESSAGE, undefined, "INVITE_EXPIRED");
}

router.get("/:token", async (req, res, next) => {
  try {
    const invite = await invitesRepo.getInviteByToken(req.params.token);
    assertUsable(invite);
    const company = await companiesRepo.getCompanyById(invite.company_id);
    res.set("Cache-Control", "no-store");
    res.json({
      email: invite.email,
      companyName: company ? company.name : null,
      role: invite.role,
      expiresAt: invite.expires_at,
      requiresPassword: true
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:token/accept", validateBody(acceptInviteSchema), async (req, res, next) => {
  try {
    const invite = await invitesRepo.getInviteByToken(req.params.token);
    assertUsable(invite);

    if (await usersRepo.getUserByEmail(invite.email)) {
      throw new HttpError(409, "Er bestaat al een account met dit e-mailadres. Log in, of vraag je beheerder om hulp.");
    }
    const isCompanyAdmin = invite.role === "company_admin";
    if (isCompanyAdmin) {
      // Verlopen abonnement of volle gebruikerslimiet blokkeert ook activatie.
      await require("../services/license.service").assertCanCreate(invite.company_id, "user", { role: "company_admin" });
    }
    const passwordHash = await hashPassword(req.body.password);

    // Eerst de link claimen (atomair, eenmalig), dan pas het account aanmaken. Mislukt
    // het aanmaken, dan wordt de link weer vrijgegeven: nooit een half geactiveerd account.
    const claimed = await invitesRepo.claimInvite(invite.id);
    if (!claimed) throw new HttpError(410, USED_MESSAGE, undefined, "INVITE_USED");

    let result;
    try {
      result = await usersRepo.createUserWithSeatLimit({
        companyId: invite.company_id,
        maxUsers: isCompanyAdmin ? await plansRepo.getMaxUsersForCompany(invite.company_id) : null,
        email: invite.email,
        passwordHash,
        firstName: invite.first_name,
        lastName: invite.last_name,
        role: invite.role,
        status: "active"
      });
    } catch (error) {
      await invitesRepo.releaseInvite(invite.id);
      if (error.code === "23505" || error.number === 2627 || error.number === 2601) {
        throw new HttpError(409, "Er bestaat al een account met dit e-mailadres.");
      }
      throw error;
    }
    if (result.limitReached) {
      await invitesRepo.releaseInvite(invite.id);
      throw new HttpError(
        409,
        "De gebruikerslimiet van het abonnement van dit bedrijf is bereikt. Neem contact op met je partner of VeriPasso.",
        undefined,
        "LICENSE_LIMIT_REACHED"
      );
    }

    await logAudit({
      companyId: invite.company_id,
      userId: result.user.id,
      action: "invite_activation",
      entityType: "User",
      entityId: result.user.id,
      metadata: { role: invite.role }
    });

    res.status(201).json({ email: result.user.email, mustSetPassword: false });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
