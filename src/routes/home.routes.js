const express = require("express");
const { SESSION_COOKIE_NAME, getUserForToken } = require("../middleware/auth");
const { getHomePathForRole } = require("../services/entraLogin.service");

const router = express.Router();

router.get("/", (req, res) => {
  res.redirect("/login.html");
});

// Wie al een geldige sessie heeft, hoeft het loginformulier niet te zien: direct door naar
// de eigen omgeving. Dit gebeurt hier op de server en niet in login.js met een
// /api/auth/me-check, want die gaf elke anonieme bezoeker een 401 (en daarmee een fout in de
// browserconsole). Zonder sessie-cookie geen DB-lookup; een ongeldige of verlopen sessie
// (of een DB-storing) toont gewoon het formulier via express.static.
router.get("/login.html", async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    next();
    return;
  }
  try {
    const user = await getUserForToken(token);
    if (!user) {
      next();
      return;
    }
    // Niet cachen: na uitloggen moet dezelfde URL weer het formulier geven.
    res.set("Cache-Control", "no-store");
    res.redirect(getHomePathForRole(user.role));
  } catch (error) {
    console.error("Sessiecontrole op de loginpagina mislukt:", error.message);
    next();
  }
});

module.exports = router;
