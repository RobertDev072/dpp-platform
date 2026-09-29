const express = require("express");
const { requireAuth, requireRole, denyIfImpersonating } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");
const { createUserSchema, updateUserSchema } = require("../schemas/users.schema");
const usersRepo = require("../repositories/users.repository");
const plansRepo = require("../repositories/plans.repository");
const { hashPassword } = require("../utils/password");
const { generateTempPassword } = require("../utils/tempPassword");
const { assertCompanyAccess } = require("../utils/tenant");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { isEntraConfigured } = require("../config/entra");
const graphClient = require("../services/graphClient");
const { PLATFORM_OWNER_ROLES, isPlatformOwner } = require("../utils/roles");

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

    // platform_owner is nooit een toekenbare rol (schema dwingt dit al af); iedereen
    // die hier komt maakt dus een company_admin of company_user aan.
    if (req.user.role === "company_admin") {
      body.companyId = req.user.companyId;
    } else if (body.companyId == null) {
      next(new HttpError(400, "companyId is verplicht voor deze rol"));
      return;
    }

    const existing = await usersRepo.getUserByEmail(body.email);
    if (existing) {
      next(new HttpError(409, "E-mailadres is al in gebruik"));
      return;
    }

    const maxUsers = body.companyId != null ? await plansRepo.getMaxUsersForCompany(body.companyId) : null;

    // Snelle pre-check vóór een eventuele Graph-call: voorkomt in het gangbare geval dat
    // er een Entra-account wordt aangemaakt terwijl de seat-limit al bereikt is. De
    // race-veilige, autoritatieve check zit in createUserWithSeatLimit hieronder.
    if (maxUsers != null) {
      const currentCount = await usersRepo.countActiveUsers(body.companyId);
      if (currentCount >= maxUsers) {
        next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
        return;
      }
    }

    let passwordHash = null;
    let entraObjectId = null;
    let tempPassword;

    if (isEntraConfigured()) {
      tempPassword = generateTempPassword();
      const displayName = [body.firstName, body.lastName].filter(Boolean).join(" ") || body.email;
      const created = await graphClient.createEntraUser({
        email: body.email,
        displayName,
        tempPassword
      });
      entraObjectId = created.entraObjectId;
    } else {
      // Legacy-modus (Entra-provisioning niet geconfigureerd): genereer zelf een
      // tijdelijk wachtwoord i.p.v. de aanmaak te blokkeren - het nieuwe
      // aanmaakformulier heeft bewust geen wachtwoordveld meer.
      if (!body.password) {
        tempPassword = generateTempPassword();
        passwordHash = await hashPassword(tempPassword);
      } else {
        passwordHash = await hashPassword(body.password);
      }
    }

    const { limitReached, user } = await usersRepo.createUserWithSeatLimit({
      companyId: body.companyId,
      maxUsers,
      email: body.email,
      passwordHash,
      entraObjectId,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
      status: body.status
    });

    if (limitReached) {
      // Zeldzame race: de snelle pre-check hierboven zag nog ruimte, maar een
      // gelijktijdige aanvraag heeft de laatste plek net ingenomen. Het eventueel al
      // aangemaakte Entra-account blijft dan als ongebruikt account achter in de
      // tenant (bekende MVP-beperking, zie docs/entra-external-id-setup.md).
      next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
      return;
    }

    await logAudit({
      companyId: user.company_id,
      userId: req.user.id,
      action: "create",
      entityType: "User",
      entityId: user.id,
      metadata: { via: entraObjectId ? "entra" : "local" }
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

    const updated = await usersRepo.updateUser(id, req.body);

    // Best-effort: DPP's eigen status-check (in requireAuth) blokkeert toegang meteen en
    // onafhankelijk hiervan. Een Graph-fout hier mag de DPP-statuswijziging dus nooit
    // blokkeren. Elke niet-actieve status (blocked/suspended/archived) schakelt het
    // Entra-account uit; terugzetten naar active schakelt het weer in.
    if (req.body.status !== undefined && existing.entra_object_id) {
      try {
        if (req.body.status === "deleted") {
          await graphClient.deleteEntraUser(existing.entra_object_id);
        } else {
          await graphClient.setAccountEnabled(existing.entra_object_id, req.body.status === "active");
        }
      } catch (error) {
        console.error("Entra account bijwerken/verwijderen mislukt:", error.message);
      }
    }

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
    const authInfo = await usersRepo.getUserAuthInfo(id);
    const tempPassword = generateTempPassword();

    if (authInfo?.entraObjectId) {
      await graphClient.resetPassword(authInfo.entraObjectId, tempPassword);
    } else if (authInfo?.hasLocalPassword) {
      await usersRepo.updatePasswordHash(id, await hashPassword(tempPassword));
    } else {
      next(new HttpError(409, "Dit account heeft geen wachtwoordmethode; neem contact op met de beheerder"));
      return;
    }

    await usersRepo.setMustChangePassword(id, true);

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "reset_password",
      entityType: "User",
      entityId: id,
      metadata: { via: authInfo.entraObjectId ? "entra" : "lokaal" }
    });

    res.json({ tempPassword });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
