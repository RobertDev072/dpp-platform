import { NextResponse } from "next/server.js";

// Afscherming van de Lambda Function URL: alleen CloudFront mag de app bereiken.
// CloudFront voegt de geheime header X-Origin-Verify toe; een verzoek dat rechtstreeks
// naar de Function URL gaat, heeft die niet en krijgt 403. Zo blijven de firewall,
// de domeinrouter en de caching van CloudFront altijd in het pad.
//
// Alleen verzoeken die via de Function URL binnenkomen worden gecontroleerd. De Lambda
// Web Adapter zet x-amzn-request-context op élke aanroep: bij de Function URL de
// request-context als JSON-object, bij een directe aanroep (migraties, onderhoud via
// AWS_LWA_PASS_THROUGH_PATH) de waarde "null". Loopback-aanroepen (de paspoortpagina die
// de API leest) en lokaal ontwikkelen hebben de header niet en worden niet gehinderd.
function isFunctionUrlRequest(requestContext) {
  if (!requestContext) return false;
  try {
    const parsed = JSON.parse(requestContext);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return true; // onbekende vorm: veilig kant, behandelen als verzoek van buiten
  }
}

export function proxy(request) {
  const secret = process.env.ORIGIN_VERIFY_SECRET;
  if (!secret || !isFunctionUrlRequest(request.headers.get("x-amzn-request-context"))) {
    return NextResponse.next();
  }
  if (request.headers.get("x-origin-verify") === secret) {
    return NextResponse.next();
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export const config = {
  matcher: "/:path*"
};
