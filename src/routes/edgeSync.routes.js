const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const { getPool } = require("../config/db");
const { validateBody } = require("../middleware/validate");
const { HttpError } = require("../middleware/errorHandler");
const edgeCache = require("../services/edgeCache.service");
const logger = require("../utils/logger");

// Synchronisatie met de Cloudflare Worker voor het QR-domein (edge/cloudflare/), elke
// minuut één verzoek in plaats van één per scan:
// - de Worker levert de scans van de afgelopen minuut aan (gebundeld; de paspoortpagina
//   meldt elke weergave via een beacon, en de Worker vangt die op);
// - de app geeft terug welke paspoorten gewijzigd zijn, zodat de Worker die uit de
//   Cloudflare-cache haalt (zo heeft de app geen Cloudflare-sleutel nodig). De Worker bevestigt
//   bij de volgende synchronisatie met "ack" wat hij heeft ververst.
//
// Alleen actief met EDGE_SYNC_TOKEN; de Worker stuurt hetzelfde token als Bearer.

const MAX_EVENTS = 500;
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const syncSchema = z.object({
  events: z
    .array(
      z.object({
        publicId: z.string().regex(UUID),
        ts: z.number().int().positive(),
        userAgent: z.string().max(500).nullable().optional(),
        referrer: z.string().max(1000).nullable().optional()
      })
    )
    .max(MAX_EVENTS)
    .default([]),
  ack: z.number().int().min(0).default(0)
});

function tokenMatches(header) {
  const expected = process.env.EDGE_SYNC_TOKEN;
  const match = /^Bearer (.+)$/.exec(header || "");
  if (!expected || !match) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const router = express.Router();

router.post(
  "/sync",
  (req, res, next) => {
    // Zonder token bestaat het endpoint niet; met een fout token ook niet (geen hint).
    if (!tokenMatches(req.get("authorization"))) {
      next(new HttpError(404, "Niet gevonden"));
      return;
    }
    next();
  },
  validateBody(syncSchema),
  async (req, res, next) => {
    try {
      const { events, ack } = req.body;
      let recorded = 0;
      if (events.length) {
        // Tijdstip van de scan zelf (niet van de bundel), begrensd tot de afgelopen
        // twee dagen en nooit in de toekomst.
        const now = Date.now();
        const ts = events.map((e) => new Date(Math.min(now, Math.max(now - MAX_AGE_MS, e.ts))).toISOString());
        const pool = await getPool();
        // Alleen paspoorten die echt openbaar zijn (zelfde voorwaarde als de publieke
        // route): onbekende of niet-gepubliceerde id's tellen niet mee.
        const result = await pool.query(
          `INSERT INTO dbo.scanevents (product_id, scanned_at, user_agent, referrer)
           SELECT p.id, e.ts, e.ua, e.ref
           FROM unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::text[]) AS e(public_id, ts, ua, ref)
           JOIN dbo.passportids pi ON pi.public_id = e.public_id
           JOIN dbo.products p ON p.id = pi.product_id
             AND (p.status = 'published' OR (p.status = 'archived' AND p.published_at IS NOT NULL))`,
          [
            events.map((e) => e.publicId.toLowerCase()),
            ts,
            events.map((e) => e.userAgent || null),
            events.map((e) => e.referrer || null)
          ]
        );
        recorded = result.rowCount;
      }
      const purge = await edgeCache.takePurges({ ack });
      logger.info("edge_sync", { received: events.length, recorded, ack, purgePaths: purge.paths.length });
      res.set("Cache-Control", "no-store");
      res.json({ recorded, purge });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
