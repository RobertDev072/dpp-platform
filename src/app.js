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

// Op AWS termineren CloudFront en de load balancer (ALB) TLS vóór de app: twee
// proxy-hops (TRUST_PROXY_HOPS=2, gezet door de taakdefinitie). Zonder de juiste
// waarde is req.protocol "http" (verkeerde QR-/activatielinks) en req.ip het
// proxy-adres (waardoor rate-limiting per bezoeker niet zou werken). Een te hoge
// waarde zou bezoekers hun eigen IP laten verzinnen via X-Forwarded-For.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.disable("x-powered-by");

// Liveness (ALB-healthcheck, uptime-monitor): bewust alleen "OK" en geen
// afhankelijkheden, zodat een korte databasestoring niet alle taken laat herstarten.
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

// Request-telemetrie (monitoring): alleen tellers en duur, nooit bodies/headers/
// query strings. Route wordt tot een patroon genormaliseerd (id's/tokens eruit).
const requestMetrics = require("./monitoring/requestMetrics");
const scheduler = require("./monitoring/scheduler");
app.use((req, res, next) => {
  if (req.path.startsWith("/api/health")) {
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

app.use("/api/auth", authRoutes);
app.use("/api/admin/companies", companiesRoutes);
app.use("/api/users", usersRoutes);
// Vóór productsRoutes: anders vangt GET /api/products/:id "import"/"bulk" als id.
app.use("/api/products/import", require("./routes/productImport.routes"));
app.use("/api/products/bulk", require("./routes/productBulk.routes"));
app.use("/api/products", productsRoutes);
app.use("/api/print", require("./routes/print.routes"));
app.use("/api/search", require("./routes/search.routes"));
app.use("/api/admin/plans", plansRoutes);
app.use("/api/invites", inviteActivationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/public/products", publicProductsRoutes);
// Machineleesbare productpaspoorten (JSON, JSON-LD, XML via content negotiation) en
// de versiegeschiedenis van gepubliceerde paspoorten.
app.use("/api/dpp", require("./routes/dpp.routes"));
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/admin/system", require("./routes/systemMonitoring.routes"));
app.use("/api/partner", require("./routes/partner.routes"));
app.use("/api/audit", require("./routes/audit.routes"));
app.use("/api/company", require("./routes/company.routes"));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
