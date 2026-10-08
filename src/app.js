require("./config/zod");
const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth.routes");
const companiesRoutes = require("./routes/companies.routes");
const usersRoutes = require("./routes/users.routes");
const productsRoutes = require("./routes/products.routes");
const plansRoutes = require("./routes/plans.routes");
const inviteActivationRoutes = require("./routes/inviteActivation.routes");
const passwordResetRoutes = require("./routes/passwordReset.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const publicProductsRoutes = require("./routes/publicProducts.routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Vercel termineert TLS vóór onze functie; zonder deze instelling is req.protocol
// "http" (verkeerde QR-/activatielinks) en req.ip het proxy-adres (waardoor
// rate-limiting per bezoeker niet zou werken).
app.set("trust proxy", 1);

// Publieke healthcheck (voor een externe uptime-monitor): bewust alleen "OK", geen
// enkel infrastructuurdetail. Gedetailleerde health zit owner-only achter
// /api/admin/system/health.
app.get("/api/health", (req, res) => res.status(200).send("OK"));

// Dagelijks onderhoud via Vercel Cron (zie vercel.json); vóór de telemetrie zodat
// de cron-aanroep zelf het verkeer niet vertekent.
app.use("/api/cron", require("./routes/cron.routes"));

// Request-telemetrie (monitoring): alleen tellers en duur, nooit bodies/headers/
// query strings. Route wordt tot een patroon genormaliseerd (id's/tokens eruit).
const requestMetrics = require("./monitoring/requestMetrics");
const scheduler = require("./monitoring/scheduler");
app.use((req, res, next) => {
  if (req.path === "/api/health") {
    next();
    return;
  }
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    requestMetrics.record({
      // De publieke paspoortpagina (/p/:id) haalt zijn data via deze API op; zo
      // blijft "publiek" als eigen scope zichtbaar in de monitoring.
      scope: req.path.startsWith("/api/public/") ? "public" : "api",
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

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
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
app.use("/api/password-reset", passwordResetRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/public/products", publicProductsRoutes);
app.use("/api/admin", require("./routes/admin.routes"));
app.use("/api/admin/system", require("./routes/systemMonitoring.routes"));
app.use("/api/partner", require("./routes/partner.routes"));
app.use("/api/audit", require("./routes/audit.routes"));
app.use("/api/company", require("./routes/company.routes"));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
