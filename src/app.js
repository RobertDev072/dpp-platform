const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const homeRoutes = require("./routes/home.routes");
const authRoutes = require("./routes/auth.routes");
const entraAuthRoutes = require("./routes/entraAuth.routes");
const companiesRoutes = require("./routes/companies.routes");
const plansRoutes = require("./routes/plans.routes");
const adminInvitationsRoutes = require("./routes/adminInvitations.routes");
const adminStatsRoutes = require("./routes/adminStats.routes");
const invitationsRoutes = require("./routes/invitations.routes");
const auditRoutes = require("./routes/audit.routes");
const usersRoutes = require("./routes/users.routes");
const companyRoutes = require("./routes/company.routes");
const productsRoutes = require("./routes/products.routes");
const documentsRoutes = require("./routes/documents.routes");
const publicRoutes = require("./routes/public.routes");
const { securityHeaders } = require("./middleware/securityHeaders");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.disable("x-powered-by");

// Op Azure App Service staat er altijd een reverse proxy voor de app; zonder deze
// instelling zien req.ip/req.protocol alleen de proxy. Alleen aanzetten achter een proxy.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(securityHeaders);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser(process.env.COOKIE_SECRET));

app.use("/", homeRoutes);
app.use("/api/auth", authRoutes);
app.use("/auth", entraAuthRoutes);

// System Owner (platformbeheer)
app.use("/api/admin/companies", companiesRoutes);
app.use("/api/admin/plans", plansRoutes);
app.use("/api/admin/invitations", adminInvitationsRoutes);
app.use("/api/admin", adminStatsRoutes); // GET /api/admin/stats, GET /api/admin/settings

// Publiek: uitnodiging activeren (token in de body, nooit in de URL)
app.use("/api/invitations", invitationsRoutes);

// Gedeeld (autorisatie per permissie + tenant-scope in de route)
app.use("/api/audit", auditRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/documents", documentsRoutes);

// Publieke DPP-pagina + JSON (geen login)
app.use("/", publicRoutes);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
