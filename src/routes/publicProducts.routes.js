const express = require("express");
const { waitUntil } = require("@vercel/functions");
const productsRepo = require("../repositories/products.repository");
const documentsRepo = require("../repositories/documents.repository");
const storageService = require("../services/storage.service");
const { getPublicPassport } = require("../services/publicPassport.service");
const { HttpError } = require("../middleware/errorHandler");

const router = express.Router();

// Publiek endpoint, geen requireAuth/requireRole: iedereen met de public_id (via de
// QR-code) mag dit productpaspoort zien.
router.get("/:publicId", async (req, res, next) => {
  try {
    const passport = await getPublicPassport(req.params.publicId, {
      userAgent: req.get("user-agent"),
      referrer: req.get("referer"),
      onScanRecorded: (pending) => waitUntil(pending)
    });
    if (!passport) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    res.json(passport);
  } catch (error) {
    next(error);
  }
});

// Publiek document van een gepubliceerd product: alleen is_public-documenten, en
// alleen bereikbaar met de public_id van een gepubliceerd/gearchiveerd product.
// Geüploade bestanden: redirect naar een kortlevende signed URL (de bucket blijft
// privé; zonder geldige public_id is er niets te raden of te benaderen).
router.get("/:publicId/documents/:documentId/file", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    const document = await documentsRepo.getDocumentById(Number(req.params.documentId));
    if (!document || document.product_id !== product.id || !document.is_public || document.archived_at) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (document.blob_name) {
      await storageService.redirectToObject(res, "document", document.blob_name);
      return;
    }
    if (document.storage_url) {
      res.redirect(302, document.storage_url);
      return;
    }
    next(new HttpError(404, "Niet gevonden"));
  } catch (error) {
    next(error);
  }
});

router.get("/:publicId/photo", async (req, res, next) => {
  try {
    const product = await productsRepo.getProductByPublicId(req.params.publicId);
    if (!product) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }

    if (product.photo_blob_name) {
      await storageService.redirectToObject(res, "photo", product.photo_blob_name);
      return;
    }

    if (product.photo_url) {
      res.redirect(302, product.photo_url);
      return;
    }

    next(new HttpError(404, "Geen foto beschikbaar"));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
