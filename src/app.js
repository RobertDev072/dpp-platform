const express = require("express");
const homeRoutes = require("./routes/home.routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(express.json());
app.use("/", homeRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
