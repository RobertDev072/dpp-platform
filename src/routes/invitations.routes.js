const express = require("express");
const { validateBody } = require("../middleware/validate");
const { rateLimit } = require("../middleware/rateLimit");
const { noStore } = require("../middleware/securityHeaders");
const { lookupInvitationSchema, acceptInvitationSchema } = require("../schemas/invitations.schema");
const invitationService = require("../services/invitation.service");

// Publiek (geen login): de uitgenodigde heeft nog geen account. Het token komt alleen in
// de JSON-body binnen — nooit in URL of query, zodat het niet in logs belandt.
const router = express.Router();

const WINDOW_MS = 15 * 60 * 1000;

// Per endpoint een eigen teller: een paar keer de pagina herladen (lookup) mag de
// pogingen om het formulier te versturen (accept) niet opmaken. Tokens zijn 256 bits
// random, dus de limiet is vooral tegen misbruik van bcrypt/Graph, niet tegen raden.
const lookupLimiter = rateLimit({ windowMs: WINDOW_MS, max: 20 });
const acceptLimiter = rateLimit({ windowMs: WINDOW_MS, max: 20 });

router.use(noStore);

router.post("/lookup", lookupLimiter, async (req, res, next) => {
  try {
    // Een verminkt token is gewoon een ongeldige link: zelfde 404 als een onbekend token.
    const parsed = lookupInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      next(invitationService.inviteInvalidError());
      return;
    }
    res.json(await invitationService.lookupInvitation(parsed.data.token));
  } catch (error) {
    next(error);
  }
});

router.post("/accept", acceptLimiter, validateBody(acceptInvitationSchema), async (req, res, next) => {
  try {
    const { token, password, firstName, lastName } = req.body;
    res.json(await invitationService.acceptInvitation({ token, password, firstName, lastName }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
