require("dotenv").config();
const app = require("./src/app");
const { isEntraLoginConfigured } = require("./src/config/entra");

const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`DPP Platform draait op poort ${PORT}`);
});
