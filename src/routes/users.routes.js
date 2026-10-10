const express = require("express");
const { requireAuth, requireRole, denyIfImpersonating } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createUserSchema, updateUserSchema } = require("../schemas/users.schema");
const usersRepo = require("../repositories/users.repository");
const plansRepo = require("../repositories/plans.repository");
const companiesRepo = require("../repositories/companies.repository");
const { hashPassword } = require("../utils/password");
const { generateTempPassword } = require("../utils/tempPassword");
const { assertCompanyAccess } = require("../utils/tenant");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { PLATFORM_OWNER_ROLES, isPlatformOwner } = require("../utils/roles");
const licenseService = require("../services/license.service");

const router = express.Router();

router.use(requireAuth, requireRole(...PLATFORM_OWNER_ROLES, "company_admin"));

router.get("/", async (req, res, next) => {
  try {
    if (req.user.role === "company_admin") {
      res.json(await usersRepo.listUsers({ companyId: req.user.companyId }));
      return;
    }

    const companyId = req.query.companyId !== undefined ? Number(req.query.companyId) : undefined;
    res.json(await usersRepo.listUsers({ companyId }));
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createUserSchema), async (req, res, next) => {
  try {
    const body = { ...req.body };

    // platform_owner is nooit een toekenbare rol (schema dwingt dit al af).
    // partner_admin is exclusief terrein van de Platform Owner.
    if (body.role === "partner_admin" && !isPlatformOwner(req.user.role)) {
      next(new HttpError(403, "Alleen de Platform Owner beheert Partner Admin-accounts"));
      return;
    }

    if (req.user.role === "company_admin") {
      body.companyId = req.user.companyId;
    } else if (body.companyId == null) {
      next(new HttpError(400, "companyId is verplicht voor deze rol"));
      return;
    }

    // Rol en bedrijfssoort moeten kloppen: partner_admin hoort bij een partnerbedrijf,
    // company-rollen bij een klantbedrijf (anders zou een partnerbedrijf via een
    // company_admin alsnog productmodules krijgen).
    const doelbedrijf = await companiesRepo.getCompanyById(body.companyId);
    if (!doelbedrijf) {
      next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { companyId: ["Bedrijf bestaat niet"] } }));
      return;
    }
    if (body.role === "partner_admin" && doelbedrijf.kind !== "partner") {
      next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { companyId: ["Partner Admins horen bij een partnerbedrijf"] } }));
      return;
    }
    if (body.role !== "partner_admin" && doelbedrijf.kind === "partner") {
      next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { role: ["In een partnerbedrijf zijn alleen Partner Admins mogelijk"] } }));
      return;
    }

    const existing = await usersRepo.getUserByEmail(body.email);
    if (existing) {
      next(new HttpError(409, "E-mailadres is al in gebruik"));
      return;
    }

    const maxUsers = body.companyId != null ? await plansRepo.getMaxUsersForCompany(body.companyId) : null;

    // Licentiecheck: dekt zowel een verlopen licentie als de seat-limiet (per
    // bedrijf). De race-veilige, autoritatieve seat-check zit daarnaast in
    // createUserWithSeatLimit hieronder.
    if (body.companyId != null) {
      await licenseService.assertCanCreate(body.companyId, "user");
    }

    // Het aanmaakformulier heeft bewust geen wachtwoordveld: de server genereert een
    // eenmalig getoond tijdelijk wachtwoord (gedwongen wijziging bij eerste login).
    let tempPassword;
    let passwordHash;
    if (!body.password) {
      tempPassword = generateTempPassword();
      passwordHash = await hashPassword(tempPassword);
    } else {
      passwordHash = await hashPassword(body.password);
    }

    const { limitReached, user } = await usersRepo.createUserWithSeatLimit({
      companyId: body.companyId,
      maxUsers,
      email: body.email,
      passwordHash,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
      status: body.status
    });

    if (limitReached) {
      // Zeldzame race: de snelle pre-check hierboven zag nog ruimte, maar een
      // gelijktijdige aanvraag heeft de laatste plek net ingenomen.
      next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
      return;
    }

    await logAudit({
      companyId: user.company_id,
      userId: req.user.id,
      action: "create",
      entityType: "User",
      entityId: user.id,
      metadata: { via: "local" }
    });

    // Bij een gegenereerd tijdelijk wachtwoord: gedwongen wijziging bij eerste login.
    if (tempPassword) {
      await usersRepo.setMustChangePassword(user.id, true);
    }

    res.status(201).json(tempPassword ? { ...user, tempPassword } : user);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", validateBody(updateUserSchema), async (req, res, next) => {
  try {
    // Tijdens impersonatie zijn rol- en statuswijzigingen geblokkeerd; naamswijzigingen
    // (gewoon supportwerk) mogen wel en blijven via de audit-log herleidbaar.
    if (req.user.impersonator && (req.body.role !== undefined || req.body.status !== undefined)) {
      next(new HttpError(403, "Rol- en statuswijzigingen zijn niet toegestaan tijdens impersonatie"));
      return;
    }

    // Definitief verwijderen is voorbehouden aan de Platform Owner; Company Admins
    // archiveren (omkeerbaar, QR- en audit-historie blijft intact).
    if (req.body.status === "deleted" && !isPlatformOwner(req.user.role)) {
      next(new HttpError(403, "Alleen de Platform Owner kan definitief verwijderen. Gebruik Archiveren."));
      return;
    }

    const id = Number(req.params.id);
    const existing = await usersRepo.getUserById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    // Het Platform Owner-account is voor iedereen behalve zichzelf onzichtbaar (404,
    // geen 403: niet bevestigen dat het bestaat), en ook voor zichzelf zijn rol en
    // status via de API onwijzigbaar.
    if (isPlatformOwner(existing.role)) {
      if (req.user.id !== existing.id) {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      if (req.body.role !== undefined || req.body.status !== undefined) {
        next(new HttpError(403, "Rol en status van de Platform Owner zijn niet wijzigbaar"));
        return;
      }
    }

    if (req.user.role === "company_admin") {
      assertCompanyAccess(req.user, existing.company_id);
    }

    const wijzigtRolOfStatus = req.body.role !== undefined || req.body.status !== undefined;

    // Partner Admin-accounts (en de rol zelf) zijn exclusief terrein van de
    // Platform Owner. De rol is bovendien alleen geldig binnen een partnerbedrijf.
    if ((existing.role === "partner_admin" || req.body.role === "partner_admin") && !isPlatformOwner(req.user.role)) {
      next(new HttpError(403, "Alleen de Platform Owner beheert Partner Admin-accounts"));
      return;
    }
    if (req.body.role !== undefined && req.body.role !== existing.role) {
      const doelbedrijf = existing.company_id != null ? await companiesRepo.getCompanyById(existing.company_id) : null;
      if (req.body.role === "partner_admin" && (!doelbedrijf || doelbedrijf.kind !== "partner")) {
        next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { role: ["Partner Admins horen bij een partnerbedrijf"] } }));
        return;
      }
      if (req.body.role !== "partner_admin" && doelbedrijf && doelbedrijf.kind === "partner") {
        next(new HttpError(400, "Ongeldige invoer", { formErrors: [], fieldErrors: { role: ["In een partnerbedrijf zijn alleen Partner Admins mogelijk"] } }));
        return;
      }
    }

    // Niemand wijzigt zijn eigen rol of status (naam bewerken mag wel).
    if (wijzigtRolOfStatus && req.user.id === existing.id) {
      next(new HttpError(403, "Je kunt je eigen rol of status niet wijzigen"));
      return;
    }

    // Company Admins beheren elkaar niet: rol-/statuswijzigingen op een andere
    // Company Admin zijn voorbehouden aan de Platform Owner. Promoveren van een
    // Productmedewerker naar Company Admin mag wél (doelwit is dan company_user).
    if (wijzigtRolOfStatus && req.user.role === "company_admin" && existing.role === "company_admin") {
      next(new HttpError(403, "Alleen de Platform Owner beheert Company Admin-accounts"));
      return;
    }

    // Reactiveren telt mee voor de seat-limiet: anders is archiveren + herstellen
    // een gratis omweg om boven het licentiemaximum uit te komen.
    if (req.body.status === "active" && existing.status !== "active" && existing.company_id != null) {
      const maxUsers = await plansRepo.getMaxUsersForCompany(existing.company_id);
      if (maxUsers != null) {
        const activeCount = await usersRepo.countActiveUsers(existing.company_id);
        if (activeCount >= maxUsers) {
          next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
          return;
        }
      }
    }

    // Er moet altijd minimaal één actieve Company Admin per bedrijf overblijven.
    const losesAdminRole = req.body.role !== undefined && req.body.role !== "company_admin";
    const losesActiveStatus = req.body.status !== undefined && req.body.status !== "active";
    if (
      existing.role === "company_admin" &&
      existing.status === "active" &&
      existing.company_id != null &&
      (losesAdminRole || losesActiveStatus)
    ) {
      const otherAdmins = await usersRepo.countOtherActiveCompanyAdmins(existing.company_id, existing.id);
      if (otherAdmins === 0) {
        next(
          new HttpError(
            409,
            "Er moet minimaal één actieve Company Admin overblijven voor dit bedrijf",
            undefined,
            "LAST_COMPANY_ADMIN"
          )
        );
        return;
      }
    }

    // De status-check in requireAuth (en bij het inloggen) blokkeert toegang direct.
    const updated = await usersRepo.updateUser(id, req.body);

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "update",
      entityType: "User",
      entityId: id,
      metadata: req.body
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/reset-password", denyIfImpersonating, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await usersRepo.getUserById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (req.user.role === "company_admin") {
      assertCompanyAccess(req.user, existing.company_id);
    }

    // Reset geeft een tijdelijk wachtwoord dat direct werkt op de loginpagina; de
    // login dwingt daarna (via must_change_password) af dat er meteen een nieuw,
    // eigen wachtwoord wordt ingesteld voordat er een sessie ontstaat.
    const tempPassword = generateTempPassword();
    await usersRepo.updatePasswordHash(id, await hashPassword(tempPassword));
    await usersRepo.setMustChangePassword(id, true);

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "reset_password",
      entityType: "User",
      entityId: id,
      metadata: { via: "lokaal" }
    });

    res.json({ tempPassword });
  } catch (error) {
    next(error);
  }
});

// Tweestapsverificatie uitzetten voor een gebruiker die zijn telefoon én herstelcodes
// kwijt is. Zelfde autorisatie als de wachtwoordreset; de gebruiker koppelt daarna
// zelf opnieuw. Alle lopende sessies vervallen.
router.post("/:id/mfa/reset", denyIfImpersonating, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await usersRepo.getUserById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    if (req.user.role === "company_admin") {
      assertCompanyAccess(req.user, existing.company_id);
    }
    if (id === req.user.id) {
      next(new HttpError(400, "Je eigen tweestapsverificatie beheer je via je profiel"));
      return;
    }
    await usersRepo.disableMfa(id);
    await require("../middleware/auth").destroySessionsForUser(id);
    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "mfa_reset",
      entityType: "User",
      entityId: id
    });
    res.json({ mfaEnabled: false });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
