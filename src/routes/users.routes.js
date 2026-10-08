const express = require("express");
const { query, queryRows, queryOne } = require("../config/db");
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
const identity = require("../services/identity.service");
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

    // Licentiecheck vóór het aanmaken van een Supabase Auth-account: dekt zowel een verlopen licentie
    // als de seat-limiet (per bedrijf). De race-veilige, autoritatieve seat-check
    // zit daarnaast in createUserWithSeatLimit hieronder.
    if (body.companyId != null) {
      await licenseService.assertCanCreate(body.companyId, "user");
    }

    let passwordHash = null;
    let authUserId = null;
    let tempPassword;

    if (identity.isIdentityProviderConfigured()) {
      tempPassword = generateTempPassword();
      const displayName = [body.firstName, body.lastName].filter(Boolean).join(" ") || body.email;
      try {
        ({ authUserId } = await identity.createAuthUser({
          email: body.email,
          displayName,
          password: tempPassword
        }));
      } catch (error) {
        if (error instanceof identity.IdentityError && error.code === "EMAIL_EXISTS") {
          next(new HttpError(409, "E-mailadres is al in gebruik"));
          return;
        }
        throw error;
      }
    } else {
      // Lokale modus (Supabase Auth niet geconfigureerd, alleen lokaal/tests): genereer
      // zelf een tijdelijk wachtwoord i.p.v. de aanmaak te blokkeren - het
      // aanmaakformulier heeft bewust geen wachtwoordveld.
      if (!body.password) {
        tempPassword = generateTempPassword();
        passwordHash = await hashPassword(tempPassword);
      } else {
        passwordHash = await hashPassword(body.password);
      }
    }

    let created;
    try {
      created = await usersRepo.createUserWithSeatLimit({
        companyId: body.companyId,
        maxUsers,
        email: body.email,
        passwordHash,
        authUserId,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        status: body.status
      });
    } catch (error) {
      // Geen weesaccount in Supabase Auth achterlaten als de DPP-rij niet ontstaat.
      if (authUserId) await identity.deleteAuthUser(authUserId).catch(() => {});
      throw error;
    }
    const { limitReached, user } = created;

    if (limitReached) {
      // Zeldzame race: de snelle pre-check hierboven zag nog ruimte, maar een
      // gelijktijdige aanvraag heeft de laatste plek net ingenomen. Het zojuist
      // aangemaakte Supabase-account wordt weer opgeruimd.
      if (authUserId) await identity.deleteAuthUser(authUserId).catch(() => {});
      next(new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED"));
      return;
    }

    await logAudit({
      companyId: user.company_id,
      userId: req.user.id,
      action: "create",
      entityType: "User",
      entityId: user.id,
      metadata: { via: authUserId ? "supabase" : "local" }
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

    const updated = await usersRepo.updateUser(id, req.body);

    // Best-effort: DPP's eigen status-check (in requireAuth en bij het inloggen)
    // blokkeert toegang meteen en onafhankelijk hiervan. Een Supabase-fout hier mag de
    // DPP-statuswijziging dus nooit blokkeren. Elke niet-actieve status (blocked/
    // suspended/archived) blokkeert het Supabase-account; terugzetten naar active
    // deblokkeert het; 'deleted' verwijdert het definitief.
    if (req.body.status !== undefined && existing.auth_user_id && identity.isIdentityProviderConfigured()) {
      try {
        if (req.body.status === "deleted") {
          await identity.deleteAuthUser(existing.auth_user_id);
        } else {
          await identity.setAccountEnabled(existing.auth_user_id, req.body.status === "active");
        }
      } catch (error) {
        console.error("Supabase Auth-account bijwerken/verwijderen mislukt:", error.message);
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

// Doelgebruiker laden met dezelfde zichtbaarheidsregels als PATCH: de Platform
// Owner is voor anderen onzichtbaar, een Company Admin ziet alleen het eigen bedrijf.
async function loadManageableUser(req) {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? await usersRepo.getUserById(id) : null;
  if (!existing || (isPlatformOwner(existing.role) && req.user.id !== existing.id)) {
    throw new HttpError(404, "Niet gevonden");
  }
  if (req.user.role === "company_admin") {
    assertCompanyAccess(req.user, existing.company_id);
  }
  return existing;
}

// Actieve sessies van een gebruiker (geen tokens; alleen tijdstippen en browser).
router.get("/:id/sessions", async (req, res, next) => {
  try {
    const existing = await loadManageableUser(req);
    const rows = await queryRows(
      `SELECT s.id, s.created_at, s.expires_at, s.user_agent, s.impersonator_user_id IS NOT NULL AS is_impersonation
       FROM sessions s WHERE s.user_id = $1 AND s.expires_at > now() ORDER BY s.created_at DESC LIMIT 50`,
      [existing.id]
    );
    res.json({ items: rows, lastLoginAt: (await queryOne("SELECT last_login_at FROM users WHERE id = $1", [existing.id]))?.last_login_at ?? null });
  } catch (error) {
    next(error);
  }
});

// Alle sessies van een gebruiker beëindigen (bijv. bij een verloren laptop).
router.post("/:id/sessions/revoke", denyIfImpersonating, async (req, res, next) => {
  try {
    const existing = await loadManageableUser(req);
    if (existing.id === req.user.id) {
      next(new HttpError(403, "Je eigen sessies beëindig je door uit te loggen"));
      return;
    }
    const result = await query("DELETE FROM sessions WHERE user_id = $1", [existing.id]);
    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "revoke_sessions",
      entityType: "User",
      entityId: existing.id,
      metadata: { revoked: result.rowCount }
    });
    res.json({ revoked: result.rowCount });
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

    if (authInfo?.authUserId && !authInfo.hasLocalPassword) {
      try {
        await identity.setPassword(authInfo.authUserId, tempPassword);
      } catch (error) {
        if (error instanceof identity.IdentityError) {
          next(new HttpError(502, `Wachtwoordreset bij Supabase Auth mislukt: ${error.message}`));
          return;
        }
        throw error;
      }
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
      metadata: { via: authInfo.hasLocalPassword ? "lokaal" : "supabase" }
    });

    res.json({ tempPassword });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
