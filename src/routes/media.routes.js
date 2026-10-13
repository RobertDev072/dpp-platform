const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/auth");
const { HttpError } = require("../middleware/errorHandler");
const { getPool } = require("../config/db");
const { isPlatformOwner } = require("../utils/roles");
const { logAuditFromReq } = require("../utils/auditLog");

// Bedrijfslogo's en profielfoto's binnen de app (na inloggen). De afbeeldingen staan in
// de privé-fotobucket (R2) als kleine WebP; de URL bevat een versie (?v=), zodat de
// browser ze een jaar mag bewaren en een nieuw logo direct een nieuwe URL krijgt.
// Oude logo's die nog als data-URI in de database staan, worden ook geserveerd.
//
//   GET    /api/media/logos/:companyId     eigen bedrijf, partner van dat bedrijf, Platform Owner
//   GET    /api/media/avatars/:userId      jezelf, collega's van hetzelfde bedrijf, Platform Owner
//   POST   /api/media/avatar               eigen profielfoto (multipart "photo", max. 5 MB)
//   DELETE /api/media/avatar               eigen profielfoto verwijderen

const router = express.Router();
router.use(requireAuth);

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      cb(new HttpError(400, "Alleen JPEG, PNG, WEBP of GIF-afbeeldingen zijn toegestaan."));
      return;
    }
    cb(null, true);
  }
});

function mediaVersion(key) {
  // md5: dezelfde waarde rekent de database uit (LOGO_URL_SQL in companies.repository).
  return crypto.createHash("md5").update(String(key)).digest("hex").slice(0, 10);
}

async function sendImage(req, res, { blobName, dataUri }) {
  const version = mediaVersion(blobName || dataUri);
  res.set("Cache-Control", req.query.v === version ? "private, max-age=31536000, immutable" : "private, max-age=300");
  res.set("X-Content-Type-Options", "nosniff");
  if (blobName) {
    const { readImage } = require("../services/blobStorage.service");
    const { buffer, contentType } = await readImage(blobName);
    res.type(contentType).send(buffer);
    return;
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(dataUri || "");
  if (!match) throw new HttpError(404, "Niet gevonden");
  res.type(match[1]).send(Buffer.from(match[2], "base64"));
}

router.get("/logos/:companyId", async (req, res, next) => {
  try {
    const companyId = Number(req.params.companyId);
    const pool = await getPool();
    const company = (await pool.query("SELECT id, partner_id, logo, logo_blob_name FROM dbo.companies WHERE id = $1", [companyId])).rows[0];
    const allowed =
      company &&
      (isPlatformOwner(req.user.role) || req.user.companyId === company.id || (company.partner_id != null && req.user.companyId === company.partner_id));
    if (!allowed || (!company.logo_blob_name && !company.logo)) throw new HttpError(404, "Niet gevonden");
    await sendImage(req, res, { blobName: company.logo_blob_name, dataUri: company.logo });
  } catch (error) {
    next(error);
  }
});

router.get("/avatars/:userId", async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const pool = await getPool();
    const user = (await pool.query("SELECT id, company_id, avatar_blob_name FROM dbo.users WHERE id = $1", [userId])).rows[0];
    const allowed =
      user && (isPlatformOwner(req.user.role) || req.user.id === user.id || (user.company_id != null && req.user.companyId === user.company_id));
    if (!allowed || !user.avatar_blob_name) throw new HttpError(404, "Niet gevonden");
    await sendImage(req, res, { blobName: user.avatar_blob_name });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/avatar",
  (req, res, next) =>
    avatarUpload.single("photo")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(400, "De afbeelding is te groot (max 5 MB)."));
        return;
      }
      next(err);
    }),
  async (req, res, next) => {
    try {
      if (!req.file) throw new HttpError(400, "Geen bestand ontvangen.");
      const { storeSmallImage, deleteObjectQuietly, bucketFor } = require("../services/blobStorage.service");
      const objectName = await storeSmallImage({ prefix: `users/${req.user.id}`, buffer: req.file.buffer, size: 256 });
      const pool = await getPool();
      const previous = (
        await pool.query(
          `UPDATE dbo.users u SET avatar_blob_name = $2, updated_at = now()
           FROM (SELECT avatar_blob_name FROM dbo.users WHERE id = $1) old
           WHERE u.id = $1 RETURNING old.avatar_blob_name AS previous`,
          [req.user.id, objectName]
        )
      ).rows[0]?.previous;
      if (previous) await deleteObjectQuietly(bucketFor("image"), previous);
      await logAuditFromReq(req, { companyId: req.user.companyId, action: "update_profile_photo", entityType: "User", entityId: req.user.id });
      res.json({ avatarUrl: `/api/media/avatars/${req.user.id}?v=${mediaVersion(objectName)}` });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/avatar", async (req, res, next) => {
  try {
    const pool = await getPool();
    const previous = (
      await pool.query(
        `UPDATE dbo.users u SET avatar_blob_name = NULL, updated_at = now()
         FROM (SELECT avatar_blob_name FROM dbo.users WHERE id = $1) old
         WHERE u.id = $1 RETURNING old.avatar_blob_name AS previous`,
        [req.user.id]
      )
    ).rows[0]?.previous;
    if (previous) {
      const { deleteObjectQuietly, bucketFor } = require("../services/blobStorage.service");
      await deleteObjectQuietly(bucketFor("image"), previous);
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.mediaVersion = mediaVersion;
