require("./config/zod");
const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth.routes");
const companiesRoutes = require("./routes/companies.routes");
const usersRoutes = require("./routes/users.routes");
const productsRoutes = require("./routes/products.routes");
const plansRoutes = require("./routes/plans.routes");
const inviteActivationRoutes = require("./routes/inviteActivation.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const publicProductsRoutes = require("./routes/publicProducts.routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Proxy-hops vóór de app (voor req.protocol en req.ip). Zonder de juiste waarde is
// req.protocol "http" (verkeerde QR-/activatielinks) en req.ip het proxy-adres
// (waardoor rate-limiting per bezoeker niet zou werken). Een te hoge waarde zou
// bezoekers hun eigen IP laten verzinnen via X-Forwarded-For.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.disable("x-powered-by");

// Cloudflare vóór het QR-domein: voor de hosting is Cloudflare dan de bezoeker, en
// zouden alle scans van een paar Cloudflare-adressen lijken te komen (rate limiting per
// IP zou echte bezoekers blokkeren). Cloudflare zet het echte IP in CF-Connecting-IP en
// voegt via een Transform Rule de geheime header X-Edge-Verify toe. Alleen met die
// header wordt CF-Connecting-IP vertrouwd; zonder header kan iedereen hem verzinnen.
if (process.env.EDGE_SYNC_TOKEN) {
  const crypto = require("crypto");
  const secret = Buffer.from(process.env.EDGE_SYNC_TOKEN);
  app.use((req, res, next) => {
    const verify = req.get("x-edge-verify");
    const ip = req.get("cf-connecting-ip");
    if (verify && ip) {
      const given = Buffer.from(verify);
      if (given.length === secret.length && crypto.timingSafeEqual(given, secret)) {
        Object.defineProperty(req, "ip", { value: ip.trim(), configurable: true });
      }
    }
    next();
  });
}

// Liveness (healthcheck van de hosting, uptime-monitor): bewust alleen "OK" en geen
// afhankelijkheden, zodat een korte databasestoring niet alle instanties laat herstarten.
// Gedetailleerde health zit owner-only achter /api/admin/system/health.
app.get("/api/health", (req, res) => res.status(200).send("OK"));

// Readiness: kan deze taak verzoeken afhandelen (database bereikbaar)? Geen details.
app.get("/api/health/ready", async (req, res) => {
  try {
    const { getPool } = require("./config/db");
    const pool = await getPool();
    await pool.request().query("SELECT 1 AS ok");
    res.set("Cache-Control", "no-store").status(200).send("READY");
  } catch {
    res.set("Cache-Control", "no-store").status(503).send("NOT READY");
  }
});

// Capaciteit voor een externe monitor (bijv. UptimeRobot): 200 "OK" of 503 met alleen
// de namen van de onderdelen die aandacht nodig hebben (schijf, back-up, ...); geen
// cijfers of details. Een minuut gecachet, dus goedkoop bij veel aanvragen.
app.get("/api/health/capacity", async (req, res) => {
  const labels = { disk: "schijf", memory: "geheugen", backup: "back-up", certificates: "certificaat", objectStorage: "opslag" };
  try {
    const { getCapacity } = require("./monitoring/capacity");
    const { problems } = await getCapacity();
    res.set("Cache-Control", "no-store");
    if (!problems.length) {
      res.status(200).send("OK");
      return;
    }
    res.status(503).send(`WAARSCHUWING: ${problems.map((p) => labels[p.key] || p.key).join(", ")}`);
  } catch {
    res.set("Cache-Control", "no-store").status(503).send("WAARSCHUWING: controle mislukt");
  }
});

// Request-telemetrie (monitoring): alleen tellers en duur, nooit bodies/headers/
// query strings. Route wordt tot een patroon genormaliseerd (id's/tokens eruit).
const requestMetrics = require("./monitoring/requestMetrics");
const scheduler = require("./monitoring/scheduler");
app.use((req, res, next) => {
  if (req.path.startsWith("/api/health") || req.path.startsWith("/api/internal/")) {
    next();
    return;
  }
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    requestMetrics.record({
      // De publieke paspoortpagina (/p/:id) haalt zijn data via deze API op; zo
      // blijft "publiek" als eigen scope zichtbaar in de monitoring.
      scope: req.path.startsWith("/api/public/") || req.path.startsWith("/api/dpp/") ? "public" : "api",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6,
      errorMessage: res.locals.monitoringErrorMessage,
      errorCode: res.locals.monitoringErrorCode
    });
    scheduler.afterRequest();
  });
  next();
});

// Expliciete limieten: grote bestanden gaan via presigned uploads rechtstreeks naar S3.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// Synchronisatie met de Cloudflare Worker (gebundelde scans, cache verversen).
app.use("/api/edge", require("./routes/edgeSync.routes"));

app.use("/api/auth", authRoutes);
app.use("/api/admin/companies", companiesRoutes);
app.use("/api/users", usersRoutes);
// Vóór productsRoutes: anders vangt GET /api/products/:id "import"/"bulk" als id.
app.use("/api/products/import", require("./routes/productImport.routes"));
app.use("/api/products/bulk", require("./routes/productBulk.routes"));
app.use("/api/products", productsRoutes);
app.use("/api/qr", require("./routes/qrExport.routes"));
app.use("/api/search", require("./routes/search.routes"));
app.use("/api/admin/plans", plansRoutes);
app.use("/api/invites", inviteActivationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/public/products", publicProductsRoutes);
app.use("/api/scan", publicProductsRoutes.scanRouter);
// Machineleesbare productpaspoorten (JSON, JSON-LD, XML via content negotiation) en
// de versiegeschiedenis van gepubliceerde paspoorten.
app.use("/api/dpp", require("./routes/dpp.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/admin/system", require("./routes/systemMonitoring.routes"));
app.use("/api/partner", require("./routes/partner.routes"));
app.use("/api/audit", require("./routes/audit.routes"));
app.use("/api/company", require("./routes/company.routes"));
app.use("/api/media", require("./routes/media.routes"));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
