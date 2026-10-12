import { NextResponse } from "next/server.js";

// Afscherming van de Lambda Function URL: alleen CloudFront mag de app bereiken.
// CloudFront voegt de geheime header X-Origin-Verify toe; een verzoek dat rechtstreeks
// naar de Function URL gaat, heeft die niet en krijgt 403. Zo blijven de firewall,
// de domeinrouter en de caching van CloudFront altijd in het pad.
//
// Alleen verzoeken die via de Function URL binnenkomen worden gecontroleerd: de Lambda
// Web Adapter voegt daar altijd x-amzn-request-context aan toe. Interne aanroepen
// (de paspoortpagina die via loopback de API leest, en directe Lambda-taken) en lokaal
// ontwikkelen hebben die header niet en worden niet gehinderd.
export function proxy(request) {
  const secret = process.env.ORIGIN_VERIFY_SECRET;
  if (!secret || !request.headers.get("x-amzn-request-context")) {
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
