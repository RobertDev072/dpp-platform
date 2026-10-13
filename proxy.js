import { NextResponse } from "next/server.js";
import domainRouting from "./src/utils/domainRouting";

// Domeinverdeling (landingspagina / app / QR) vóór elke pagina; zie
// src/utils/domainRouting.js. Lokaal (zonder APP_DOMAIN/QR_DOMAIN) doet dit niets.
const domainConfig = domainRouting.readDomainConfig();

export function proxy(request) {
  const url = request.nextUrl;
  const result = domainRouting.routeDomain(
    { host: request.headers.get("host"), path: url.pathname, search: url.search },
    domainConfig
  );
  if (!result) return NextResponse.next();
  const response = NextResponse.redirect(result.location, result.status);
  response.headers.set("Cache-Control", result.status === 301 ? "max-age=3600" : "no-store");
  return response;
}

export const config = {
  matcher: "/:path*"
};
