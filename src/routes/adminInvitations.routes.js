const express = require("express");
const { z } = require("zod");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/permissions");
const { noStore } = require("../middleware/securityHeaders");
const { INVITATION_STATUSES } = require("../schemas/invitations.schema");
const invitationsRepo = require("../repositories/invitations.repository");
const invitationService = require("../services/invitation.service");
const { parseId } = require("../utils/params");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth, requirePermission(PERMISSIONS.PLATFORM_MANAGE));

const listQuerySchema = z.object({
  status: z.preprocess((value) => (value === "" ? undefined : value), z.enum(INVITATION_STATUSES).optional())
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new HttpError(400, "Ongeldige invoer", parsed.error.flatten()));
      return;
    }
    res.json(await invitationsRepo.listInvitations({ status: parsed.data.status }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/revoke", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    res.json(await invitationService.revokeInvitation(req, id));
  } catch (error) {
    next(error);
  }
});

// no-store: de response bevat de nieuwe activatielink (met token) precies één keer.
// 201 net als aanmaken (§8): resend trekt de oude invite in en maakt een nieuwe rij met een
// eigen id aan, het is dus geen wijziging van de bestaande invite.
router.post("/:id/resend", noStore, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    res.status(201).json(await invitationService.resendInvitation(req, id));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
