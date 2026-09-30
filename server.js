require("dotenv").config();
const http = require("http");
const next = require("next");
const app = require("./src/app");
const { isEntraLoginConfigured } = require("./src/config/entra");

const PORT = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== "production";

// Fail loud, niet stil: in productie mag login nooit ongemerkt op de bcrypt-fallback
// blijven draaien omdat iemand vergat de Entra-omgevingsvariabelen te zetten.
if (process.env.NODE_ENV === "production" && !isEntraLoginConfigured()) {
  console.error(
    "❌ NODE_ENV=production maar Entra External ID-login is niet (volledig) geconfigureerd. " +
      "Zie docs/entra-external-id-setup.md. De app start bewust niet op om een stille " +
      "terugval op de bcrypt-login in productie te voorkomen."
  );
  process.exit(1);
}

const nextApp = next({ dev, dir: "web" });
const nextHandler = nextApp.getRequestHandler();

const requestMetrics = require("./src/monitoring/requestMetrics");

// Alleen betekenisvolle pagina's meten; statics/assets zouden de telemetrie
// vervuilen zonder iets te zeggen over hoe snel VeriPasso voor bezoekers is.
const STATIC_PREFIXES = ["/_next/", "/favicon", "/icon", "/robots.txt", "/sitemap"];
function shouldMeasurePage(url) {
  const path = url.split("?")[0];
  if (STATIC_PREFIXES.some((p) => path.startsWith(p))) return false;
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico|css|js|map|woff2?)$/i.test(path)) return false;
  return true;
}

nextApp.prepare().then(() => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/auth/")) {
      // Express meet zijn eigen requests (fijnmaziger, met foutdetails).
      app(req, res);
    } else {
      if (shouldMeasurePage(req.url)) {
        const start = process.hrtime.bigint();
        res.on("finish", () => {
          requestMetrics.record({
            scope: req.url.startsWith("/p/") ? "public" : "page",
            method: req.method,
            path: req.url,
            status: res.statusCode,
            durationMs: Number(process.hrtime.bigint() - start) / 1e6
          });
        });
      }
      nextHandler(req, res);
    }
  });

  server.listen(PORT, () => {
    console.log(`DPP Platform draait op poort ${PORT}`);
    // Monitoring-scheduler (uurflush + dagelijkse snapshot) draait alleen in het
    // echte serverproces - tests/scripts importeren src/app.js en starten dit nooit.
    require("./src/monitoring/scheduler").start();
  });
});
