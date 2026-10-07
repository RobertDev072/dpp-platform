import app from "../../src/app";
import { assertProductionConfig } from "../../src/config/productionCheck";

// Alle /api/*-verzoeken gaan naar de bestaande Express-app, als één Vercel Function.
// Bewust een Pages Router API-route: die geeft Express de Node-request/response die
// het verwacht (App Router route handlers werken met Web Request/Response).
export const config = {
  api: {
    // Express parseert zelf (json/urlencoded); Next mag de body niet al opeten.
    bodyParser: false,
    // Express stuurt zelf de response; geen "API resolved without sending"-waarschuwing.
    externalResolver: true,
    responseLimit: false
  }
};

export default function handler(req, res) {
  const configError = assertProductionConfig();
  if (configError) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { message: "Serverconfiguratie onvolledig", code: "CONFIG_INCOMPLETE" } }));
    return;
  }
  return app(req, res);
}
