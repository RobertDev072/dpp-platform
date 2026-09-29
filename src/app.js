const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth.routes");
const entraAuthRoutes = require("./routes/entraAuth.routes");
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

// Azure App Service termineert TLS vóór onze Node-server; zonder deze instelling is
// req.protocol "http" (verkeerde QR-/activatielinks) en req.ip het proxy-adres
// (waardoor rate-limiting per bezoeker niet zou werken).
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET));

app.use("/api/auth", authRoutes);
app.use("/auth", entraAuthRoutes);
app.use("/api/admin/companies", companiesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/admin/plans", plansRoutes);
app.use("/api/invites", inviteActivationRoutes);
app.use("/api/password-reset", passwordResetRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/public/products", publicProductsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
