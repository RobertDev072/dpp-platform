const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const homeRoutes = require("./routes/home.routes");
const authRoutes = require("./routes/auth.routes");
const entraAuthRoutes = require("./routes/entraAuth.routes");
const companiesRoutes = require("./routes/companies.routes");
const usersRoutes = require("./routes/users.routes");
const productsRoutes = require("./routes/products.routes");
const plansRoutes = require("./routes/plans.routes");
const inviteActivationRoutes = require("./routes/inviteActivation.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET));

app.use("/", homeRoutes);
app.use("/api/auth", authRoutes);
app.use("/auth", entraAuthRoutes);
app.use("/api/admin/companies", companiesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/admin/plans", plansRoutes);
app.use("/api/invites", inviteActivationRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
