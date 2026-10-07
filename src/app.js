require("./config/zod");
const express = require("express");
const cookieParser = require("cookie-parser");
const { waitUntil } = require("@vercel/functions");
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
const requestMetrics = require("./monitoring/requestMetrics");
const { maybeFlush } = require("./monitoring/flush");

const app = express();

// Vercel termineert TLS vóór onze function; zonder deze instelling is req.protocol
// "http" (verkeerde QR-/activatielinks zonder QR_BASE_URL/APP_BASE_URL) en req.ip het
// proxy-adres (waardoor rate-limiting per bezoeker niet zou werken).
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Publieke healthcheck (bijv. voor een externe uptime-monitor): bewust alleen "OK",
// geen enkel infrastructuurdetail. Gedetailleerde health zit owner-only achter
// /api/admin/system/health.
app.get("/api/health", (req, res) => res.status(200).send("OK"));

// Request-telemetrie (monitoring): alleen tellers en duur, nooit bodies/headers/
// query strings. Route wordt tot een patroon genormaliseerd (id's/tokens eruit).
app.use((req, res, next) => {
  if (req.path === "/api/health" || req.path.startsWith("/api/cron/")) {
    next();
    return;
  }
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    requestMetrics.record({
      scope: "api",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6,
      errorMessage: res.locals.monitoringErrorMessage,
      errorCode: res.locals.monitoringErrorCode
    });
    // Hooguit elke minuut per instance wegschrijven; waitUntil laat Vercel de
    // function afmaken nadat de response al verstuurd is.
    waitUntil(maybeFlush());
  });
  next();
});

// Ruim genoeg voor import-blokken (250 rijen) en printprofielen, ruim onder de
// 4,5 MB-limiet van Vercel.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET));

app.use("/api/auth", authRoutes);
app.use("/api/admin/companies", companiesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/products", productsRoutes);
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
app.use("/api/imports", require("./routes/imports.routes"));
app.use("/api/qr", require("./routes/qr.routes"));
app.use("/api/print-profiles", require("./routes/printProfiles.routes"));
app.use("/api/workspace", require("./routes/workspace.routes"));
app.use("/api/cron", require("./routes/cron.routes"));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
