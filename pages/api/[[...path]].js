// Eén API-route voor de hele Express-API (src/app.js): alles onder /api/* komt
// hier binnen met de oorspronkelijke URL, Express doet de routering zelf. Pages-router
// API-routes geven Node's eigen req/res door, precies wat Express verwacht.
import app from "../../src/app";

export const config = {
  api: {
    // Express parseert zelf (express.json, multer); Next mag de body niet opeten.
    bodyParser: false,
    // Express beantwoordt de request; geen "API resolved without sending"-waarschuwing.
    externalResolver: true,
    responseLimit: false
  }
};

export default function handler(req, res) {
  return app(req, res);
}
