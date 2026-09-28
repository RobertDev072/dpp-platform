const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
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

const router = express.Router();

router.use(requireAuth, requireRole("system_owner", "company_admin"));

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

    if (req.user.role === "company_admin") {
      if (["system_owner"].includes(body.role)) {
        next(new HttpError(403, "Geen toegang"));
        return;
      }
      body.companyId = req.user.companyId;
    } else if (body.role === "system_owner") {
      body.companyId = null;
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
      if (!body.password) {
        next(new HttpError(400, "password is verplicht zolang Entra niet is geconfigureerd"));
        return;
      }
      passwordHash = await hashPassword(body.password);
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

    res.status(201).json(tempPassword ? { ...user, tempPassword } : user);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", validateBody(updateUserSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await usersRepo.getUserById(id);
    if (!existing) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (req.user.role === "company_admin") {
      if (existing.role === "system_owner") {
        next(new HttpError(404, "Niet gevonden"));
        return;
      }
      assertCompanyAccess(req.user, existing.company_id);

      if (req.body.role === "system_owner") {
        next(new HttpError(403, "Geen toegang"));
        return;
      }
    }

    const updated = await usersRepo.updateUser(id, req.body);

    // Best-effort: DPP's eigen status-check (in requireAuth) blokkeert toegang meteen en
    // onafhankelijk hiervan. Een Graph-fout hier mag de DPP-deactivatie dus nooit blokkeren.
    if (req.body.status === "inactive" && existing.entra_object_id) {
      try {
        await graphClient.setAccountEnabled(existing.entra_object_id, false);
      } catch (error) {
        console.error("Entra account uitschakelen mislukt:", error.message);
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

router.post("/:id/reset-password", async (req, res, next) => {
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

    if (!existing.entra_object_id) {
      next(
        new HttpError(
          400,
          "Deze gebruiker heeft geen Entra-account; gebruik zelfbedienings-wachtwoordherstel niet van toepassing"
        )
      );
      return;
    }

    // Bewuste, smalle fallback naast Entra's self-service reset (SSPR) — zie
    // docs/entra-external-id-setup.md voor de afweging tussen SSPR en admin-reset.
    const tempPassword = generateTempPassword();
    await graphClient.resetPassword(existing.entra_object_id, tempPassword);

    await logAudit({
      companyId: existing.company_id,
      userId: req.user.id,
      action: "reset_password",
      entityType: "User",
      entityId: id
    });

    res.json({ tempPassword });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
