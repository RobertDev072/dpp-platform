const express = require("express");
const { requireAuth, revokeUserSessions } = require("../middleware/auth");
const { noStore } = require("../middleware/securityHeaders");
const { validateBody } = require("../middleware/validate");
const { createUserSchema, updateUserSchema, listUsersQuerySchema } = require("../schemas/users.schema");
const usersRepo = require("../repositories/users.repository");
const plansRepo = require("../repositories/plans.repository");
const { hashPassword } = require("../utils/password");
const { generateTempPassword } = require("../utils/tempPassword");
const { assertCompanyAccess } = require("../utils/tenant");
const { parseId, parseOptionalId } = require("../utils/params");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");
const { isEntraConfigured, isEntraLoginConfigured } = require("../config/entra");
const graphClient = require("../services/graphClient");
const {
  ROLES,
  COMPANY_ROLES,
  ASSIGNABLE_BY_COMPANY_ADMIN,
  PERMISSIONS,
  hasPermission
} = require("../auth/permissions");

const router = express.Router();

// Twee soorten beheerders: de System Owner (platform:manage, alle companies) en de Company
// Admin (users:manage, alleen de eigen company). Iedereen anders krijgt 403. Welke
// gebruikers/rollen een beheerder daarna mag aanraken, checkt elke route hieronder zelf.
function requireUserManagement(req, res, next) {
  if (hasPermission(req.user, PERMISSIONS.PLATFORM_MANAGE) || hasPermission(req.user, PERMISSIONS.USERS_MANAGE)) {
    next();
    return;
  }
  next(new HttpError(403, "Geen toegang"));
}

// no-store voor alles onder /api/users: persoonsgegevens en eenmalige tijdelijke
// wachtwoorden horen niet in een browser- of proxycache.
router.use(requireAuth, requireUserManagement, noStore);

function isPlatformAdmin(user) {
  return hasPermission(user, PERMISSIONS.PLATFORM_MANAGE);
}

const STATUS_AUDIT_ACTIONS = { active: "activate", inactive: "deactivate", blocked: "block" };

function licenseLimitError() {
  return new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED");
}

function emailInUseError() {
  return new HttpError(409, "E-mailadres is al in gebruik", undefined, "EMAIL_IN_USE");
}

// Een System Owner-account wordt alleen via scripts/seed-system-owner.js (en Entra)
// beheerd. Ook status en wachtwoord: anders kan één overgenomen SO-sessie de andere SO's
// buitensluiten of via een reset hun account (blijvend, en onder hun naam) overnemen.
function systemOwnerNotManageableError(what) {
  return new HttpError(
    400,
    `${what} van een System Owner kan niet via gebruikersbeheer worden gewijzigd`,
    undefined,
    "ROLE_NOT_ALLOWED"
  );
}

function displayNameFor({ firstName, lastName, email }) {
  return [firstName, lastName].filter(Boolean).join(" ") || email;
}

// Best effort: DPP's eigen status-check (getUserForToken + login) blokkeert toegang al
// direct en onafhankelijk hiervan. Een Graph-fout mag de DPP-actie dus nooit blokkeren.
async function setEntraAccountEnabledBestEffort(entraObjectId, enabled) {
  if (!entraObjectId || !isEntraConfigured()) return;
  try {
    await graphClient.setAccountEnabled(entraObjectId, enabled);
  } catch (error) {
    console.error(`Entra account ${enabled ? "inschakelen" : "uitschakelen"} mislukt:`, error.message);
  }
}

// Haalt de doelgebruiker op en past de tenant-regels toe. Andere company (of een
// system_owner, die bij geen company hoort) -> 404 voor een Company Admin, nooit 403.
async function loadTargetUser(req) {
  const id = parseId(req.params.id);
  const target = await usersRepo.getUserById(id);
  if (!target) {
    throw new HttpError(404, "Niet gevonden");
  }
  assertCompanyAccess(req.user, target.company_id);
  return target;
}

// Een Company Admin mag alleen gebruikers beheren met een rol die hij zelf ook mag
// toekennen: andere Company Admins (en dus ook zichzelf) blijven buiten bereik.
function assertMayManageTarget(user, target) {
  if (!isPlatformAdmin(user) && !ASSIGNABLE_BY_COMPANY_ADMIN.includes(target.role)) {
    throw new HttpError(403, "Je mag deze gebruiker niet beheren", undefined, "ROLE_NOT_ASSIGNABLE");
  }
}

router.get("/", async (req, res, next) => {
  try {
    const parsed = listUsersQuerySchema.safeParse({ role: req.query.role, status: req.query.status });
    if (!parsed.success) {
      throw new HttpError(400, "Ongeldige invoer", parsed.error.flatten());
    }

    // Tenant-scope uit de sessie; alleen de System Owner mag filteren op een andere company.
    const companyId = isPlatformAdmin(req.user) ? parseOptionalId(req.query.companyId) : req.user.companyId;

    const rows = await usersRepo.listUsers({ companyId, role: parsed.data.role, status: parsed.data.status });
    res.json(rows.map(usersRepo.toClientUser));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const target = await loadTargetUser(req);
    res.json(usersRepo.toClientUser(target));
  } catch (error) {
    next(error);
  }
});

router.post("/", validateBody(createUserSchema), async (req, res, next) => {
  try {
    const body = req.body;
    let companyId;

    if (!isPlatformAdmin(req.user)) {
      if (!ASSIGNABLE_BY_COMPANY_ADMIN.includes(body.role)) {
        throw new HttpError(403, "Je mag deze rol niet toekennen", undefined, "ROLE_NOT_ASSIGNABLE");
      }
      // Een meegestuurde companyId wordt bewust genegeerd: de tenant komt uit de sessie.
      companyId = req.user.companyId;
    } else if (body.role === ROLES.SYSTEM_OWNER) {
      // Zelfde regel als bij PATCH (§8): system_owner-accounts ontstaan alleen via
      // scripts/seed-system-owner.js. Zo kan een overgenomen SO-sessie geen extra,
      // blijvende platformbeheerders aanmaken.
      throw new HttpError(
        400,
        "De rol system_owner kan niet via gebruikersbeheer worden toegekend of ingetrokken",
        undefined,
        "ROLE_NOT_ALLOWED"
      );
    } else if (body.companyId == null) {
      throw new HttpError(400, "companyId is verplicht voor deze rol", undefined, "COMPANY_REQUIRED");
    } else {
      companyId = body.companyId;
    }

    if (companyId != null) {
      const company = await usersRepo.getCompanyStatus(companyId);
      if (!company) {
        throw new HttpError(400, "Onbekend bedrijf", undefined, "COMPANY_NOT_FOUND");
      }
      if (company.status !== "active") {
        throw new HttpError(409, "Dit bedrijf is niet actief", undefined, "COMPANY_INACTIVE");
      }
    }

    // Gefaseerde setup (alleen de login-vars, nog geen Graph): de loginpagina staat al in
    // Entra-modus en lokale login is dicht, dus een lokaal wachtwoord zou een account
    // opleveren dat nergens kan inloggen. Fail closed tot de Graph-koppeling er is.
    if (isEntraLoginConfigured() && !isEntraConfigured()) {
      throw new HttpError(
        503,
        "Nieuwe gebruikers aanmaken kan pas als de Entra Graph-koppeling is geconfigureerd",
        undefined,
        "IDENTITY_PROVIDER_NOT_CONFIGURED"
      );
    }

    if (await usersRepo.emailInUse(body.email)) {
      throw emailInUseError();
    }

    const status = body.status || "active";
    const maxUsers = companyId != null ? await plansRepo.getMaxUsersForCompany(companyId) : null;

    // Snelle pre-check vóór een eventuele Graph-call: voorkomt in het gangbare geval dat
    // er een Entra-account wordt aangemaakt terwijl de seat-limit al bereikt is. De
    // race-veilige, autoritatieve check zit in createUserWithSeatLimit hieronder.
    if (maxUsers != null && status === "active") {
      const currentCount = await usersRepo.countActiveUsers(companyId);
      if (currentCount >= maxUsers) {
        throw licenseLimitError();
      }
    }

    let passwordHash = null;
    let entraObjectId = null;
    let tempPassword;
    const via = isEntraConfigured() ? "entra" : "local";

    if (via === "entra") {
      // Entra-modus: altijd een gegenereerd tijdelijk wachtwoord dat de gebruiker bij de
      // eerste login moet wijzigen. DPP slaat het nergens op (ook geen hash).
      tempPassword = generateTempPassword();
      try {
        const created = await graphClient.createEntraUser({
          email: body.email,
          displayName: displayNameFor(body),
          tempPassword,
          forceChangePasswordNextSignIn: true
        });
        entraObjectId = created.entraObjectId;
      } catch (error) {
        console.error("Entra-account aanmaken mislukt:", error.message);
        throw new HttpError(502, "Aanmaken van het Entra-account is mislukt", undefined, "IDENTITY_PROVIDER_ERROR");
      }
    } else {
      // Lokale (dev-)modus: opgegeven wachtwoord, of anders een gegenereerd tijdelijk
      // wachtwoord. Alleen de bcrypt-hash gaat de database in.
      if (!body.password) {
        tempPassword = generateTempPassword();
      }
      passwordHash = await hashPassword(body.password || tempPassword);
    }

    let result;
    try {
      result = await usersRepo.createUserWithSeatLimit({
        companyId,
        maxUsers,
        email: body.email,
        passwordHash,
        entraObjectId,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        status
      });
    } catch (error) {
      // Het net aangemaakte Entra-account hoort nu bij geen enkele DPP-user: uitschakelen.
      await setEntraAccountEnabledBestEffort(entraObjectId, false);
      if (usersRepo.isUniqueViolation(error)) {
        throw emailInUseError();
      }
      throw error;
    }

    if (result.limitReached) {
      // Zeldzame race: de snelle pre-check hierboven zag nog ruimte, maar een
      // gelijktijdige aanvraag heeft de laatste plek net ingenomen. Het eventueel al
      // aangemaakte Entra-account wordt best effort uitgeschakeld (blijft wel in de tenant).
      await setEntraAccountEnabledBestEffort(entraObjectId, false);
      throw licenseLimitError();
    }

    // Een als 'inactive' aangemaakte gebruiker mag ook in Entra (nog) niet inloggen.
    if (status !== "active") {
      await setEntraAccountEnabledBestEffort(entraObjectId, false);
    }

    await logAudit({
      companyId: result.user.company_id,
      userId: req.user.id,
      action: "create",
      entityType: "User",
      entityId: result.user.id,
      metadata: { via, role: body.role, status }
    });

    const created = usersRepo.toClientUser(await usersRepo.getUserById(result.user.id));
    // tempPassword staat alleen in déze response (no-store) en wordt nergens gelogd.
    res.status(201).json(tempPassword ? { ...created, tempPassword } : created);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", validateBody(updateUserSchema), async (req, res, next) => {
  try {
    const target = await loadTargetUser(req);
    const changes = req.body;

    const roleChanging = changes.role !== undefined && changes.role !== target.role;
    const statusChanging = changes.status !== undefined && changes.status !== target.status;

    if (target.id === req.user.id) {
      // Eigen rol/status wijzigen zou een beheerder zichzelf kunnen laten buitensluiten
      // (of rechten laten ophogen); eigen naam aanpassen mag wel.
      if (roleChanging || statusChanging) {
        throw new HttpError(400, "Je kunt je eigen rol of status niet wijzigen", undefined, "CANNOT_MODIFY_SELF");
      }
    } else {
      assertMayManageTarget(req.user, target);

      // Naam wijzigen mag; status niet (zie systemOwnerNotManageableError). Een Company
      // Admin komt hier nooit met een SO als doel: loadTargetUser gaf dan al 404.
      if (target.role === ROLES.SYSTEM_OWNER && statusChanging) {
        throw systemOwnerNotManageableError("De status");
      }

      if (roleChanging) {
        if (!isPlatformAdmin(req.user)) {
          if (!ASSIGNABLE_BY_COMPANY_ADMIN.includes(changes.role)) {
            throw new HttpError(403, "Je mag deze rol niet toekennen", undefined, "ROLE_NOT_ASSIGNABLE");
          }
        } else if (!COMPANY_ROLES.includes(changes.role) || !COMPANY_ROLES.includes(target.role)) {
          // system_owner loopt nooit via deze API: niet toekennen (zou ook CHK_Users_RoleCompany
          // breken) en niet afnemen (een System Owner heeft geen company om in te vallen).
          throw new HttpError(
            400,
            "De rol system_owner kan niet via gebruikersbeheer worden toegekend of ingetrokken",
            undefined,
            "ROLE_NOT_ALLOWED"
          );
        }
      }
    }

    // Alleen echte wijzigingen doorvoeren: zo telt "status: active" op een al actieve
    // gebruiker niet als heractivering en ontstaan geen lege audit-regels.
    const fields = {};
    if (changes.firstName !== undefined && changes.firstName !== target.first_name) fields.firstName = changes.firstName;
    if (changes.lastName !== undefined && changes.lastName !== target.last_name) fields.lastName = changes.lastName;
    if (roleChanging) fields.role = changes.role;
    if (statusChanging) fields.status = changes.status;

    if (Object.keys(fields).length === 0) {
      res.json(usersRepo.toClientUser(target));
      return;
    }

    const result = await usersRepo.updateUserWithSeatLimit(target.id, fields);
    if (result.notFound) {
      throw new HttpError(404, "Niet gevonden");
    }
    if (result.limitReached) {
      throw licenseLimitError();
    }

    // Oude sessies mogen niet doorwerken met oude rechten (rolwijziging) of na
    // deactiveren/blokkeren. getUserForToken weigert non-active al, maar intrekken maakt
    // het definitief: ook heractiveren brengt een oude sessie niet terug.
    if (roleChanging || (statusChanging && fields.status !== "active")) {
      await revokeUserSessions(target.id);
    }
    if (statusChanging) {
      await setEntraAccountEnabledBestEffort(target.entra_object_id, fields.status === "active");
    }

    const audit = { companyId: target.company_id, userId: req.user.id, entityType: "User", entityId: target.id };
    if (roleChanging) {
      await logAudit({ ...audit, action: "role_change", metadata: { from: target.role, to: fields.role } });
    }
    if (statusChanging) {
      await logAudit({
        ...audit,
        action: STATUS_AUDIT_ACTIONS[fields.status],
        metadata: { from: target.status, to: fields.status }
      });
    }
    const nameFields = ["firstName", "lastName"].filter((field) => field in fields);
    if (nameFields.length > 0) {
      await logAudit({ ...audit, action: "update", metadata: { fields: nameFields } });
    }

    res.json(usersRepo.toClientUser(await usersRepo.getUserById(target.id)));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/reset-password", async (req, res, next) => {
  try {
    const target = await loadTargetUser(req);

    if (target.id === req.user.id) {
      throw new HttpError(400, "Je kunt je eigen wachtwoord hier niet resetten", undefined, "CANNOT_MODIFY_SELF");
    }
    // Een reset geeft het nieuwe wachtwoord terug aan de beheerder: voor een SO-doel is dat
    // een blijvende tweede toegang tot het hoogste account. Company Admins zien SO's niet
    // (404 in loadTargetUser), dus dit raakt alleen SO -> SO.
    if (target.role === ROLES.SYSTEM_OWNER) {
      throw systemOwnerNotManageableError("Het wachtwoord");
    }
    assertMayManageTarget(req.user, target);

    const tempPassword = generateTempPassword();
    let via;

    if (target.entra_object_id) {
      // Bewuste, smalle fallback naast Entra's self-service reset (SSPR) — zie
      // docs/entra-external-id-setup.md voor de afweging tussen SSPR en admin-reset.
      via = "entra";
      try {
        await graphClient.resetPassword(target.entra_object_id, tempPassword);
      } catch (error) {
        console.error("Entra-wachtwoord resetten mislukt:", error.message);
        throw new HttpError(502, "Resetten van het Entra-wachtwoord is mislukt", undefined, "IDENTITY_PROVIDER_ERROR");
      }
    } else if (target.identity === "entra") {
      // Wel een Entra-identiteit (sub) maar geen bekend Graph-object: we kunnen het
      // Entra-wachtwoord niet zetten, en een lokaal wachtwoord erbij zou Entra (en MFA)
      // omzeilen. De gebruiker gebruikt "Wachtwoord vergeten?" bij Entra.
      throw new HttpError(
        409,
        "Dit account logt in via Entra; laat de gebruiker 'Wachtwoord vergeten?' gebruiken",
        undefined,
        "RESET_NOT_SUPPORTED"
      );
    } else if (isEntraLoginConfigured()) {
      // Lokaal account terwijl de login in Entra-modus staat: /api/auth/login is dan dicht,
      // dus een nieuw lokaal wachtwoord is onbruikbaar en een misleidend "tijdelijk
      // wachtwoord" voor de beheerder. Inloggen loopt via Entra (koppeling op e-mail).
      throw new HttpError(
        409,
        "In Entra-modus worden geen lokale wachtwoorden uitgegeven; de gebruiker logt in via Entra ('Wachtwoord vergeten?')",
        undefined,
        "RESET_NOT_SUPPORTED"
      );
    } else {
      via = "local";
      await usersRepo.setPasswordHash(target.id, await hashPassword(tempPassword));
    }

    await revokeUserSessions(target.id);

    await logAudit({
      companyId: target.company_id,
      userId: req.user.id,
      action: "reset_password",
      entityType: "User",
      entityId: target.id,
      metadata: { via }
    });

    res.json({ tempPassword });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
