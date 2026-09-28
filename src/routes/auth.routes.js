const express = require("express");
const { loginSchema } = require("../schemas/auth.schema");
const { validateBody } = require("../middleware/validate");
const { getUserByEmail } = require("../repositories/users.repository");
const { verifyPassword, DUMMY_HASH } = require("../utils/password");
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
} = require("../middleware/auth");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);

    // Draai bcrypt.compare altijd, ook als de gebruiker niet bestaat of Entra-only is
    // (geen password_hash): anders is het tijdsverschil een enumeratie-lek.
    const hashToCheck = user && user.password_hash ? user.password_hash : DUMMY_HASH;
    const passwordMatches = await verifyPassword(password, hashToCheck);

    if (!user || !user.password_hash || user.status !== "active" || !passwordMatches) {
      next(new HttpError(401, "Ongeldige inloggegevens"));
      return;
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(res, token, expiresAt);

    await logAudit({
      companyId: user.company_id,
      userId: user.id,
      action: "login",
      entityType: "User",
      entityId: user.id
    });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await destroySession(req.sessionToken);
    clearSessionCookie(res);

    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.id,
      action: "logout",
      entityType: "User",
      entityId: req.user.id
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;
