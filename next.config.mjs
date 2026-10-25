/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  // Zelfstandige build voor het Docker-image (zie Dockerfile): alleen de benodigde
  // bestanden en node_modules, gestart met `node server.js`.
  output: "standalone",
  // De Express-API (src/, CommonJS) draait binnen pages/api/[[...path]].js. Deze
  // pakketten niet bundelen maar als gewone node_modules laden: ze gebruiken
  // dynamische requires of meegeleverde databestanden (pdfkit-fonts).
  serverExternalPackages: [
    "express",
    "pg",
    "multer",
    "pdfkit",
    "qrcode",
    "bcryptjs",
    "cookie-parser",
    "express-rate-limit",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner"
  ],
  // pdfkit leest zijn standaardfonts (Helvetica.afm) van schijf voor het QR-label;
  // de migraties zitten in het image voor de eenmalige migratietaak (npm run migrate).
  outputFileTracingIncludes: {
    "/api/[[...path]]": ["./node_modules/pdfkit/js/data/**"]
  },
  // Content negotiation op de permanente QR-URL (EN 18216, clausule 5): een
  // browser krijgt de HTML-paspoortpagina, een systeem dat JSON, JSON-LD of XML vraagt
  // krijgt op exact dezelfde URL de machineleesbare representatie. Gedrukte QR-codes
  // hoeven daarvoor niet te veranderen.
  async rewrites() {
    return {
      beforeFiles: [
        // Landingspagina (www.veripasso.com): één statisch HTML-bestand, zie public/landing/.
        // Op het app-domein stuurt proxy.js "/" eerst door naar /login.
        { source: "/", destination: "/landing/index.html" },
        {
          source: "/p/:publicId",
          // Browsers sturen o.a. "application/xml;q=0.9" mee: alleen herschrijven als er
          // géén text/html gevraagd wordt.
          has: [{ type: "header", key: "accept", value: "^(?!.*text/html).*application/(?:ld\\+json|json|xml).*$" }],
          destination: "/api/dpp/:publicId"
        }
      ]
    };
  },
  // Standaard beveiligingsheaders op elke response. HSTS ook hier (naast een eventuele CDN),
  // zodat de policy niet afhangt van één laag.
  async headers() {
    // Content-Security-Policy: scripts alleen van VeriPasso zelf (en GSAP/Lenis van jsDelivr
    // voor de landingspagina); verbindingen alleen naar VeriPasso en de bestandsopslag (R2,
    // directe uploads). 'unsafe-inline' is nodig voor de inline scripts van Next.js en de
    // landingspagina. Alleen in productie: de ontwikkelmodus van Next gebruikt eval.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.r2.cloudflarestorage.com https://*.eu.r2.cloudflarestorage.com",
      "media-src 'self' https:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests"
    ].join("; ");
    const cspHeaders = process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: csp }] : [];
    return [
      {
        source: "/:path*",
        headers: [
          ...cspHeaders,
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" }
        ]
      },
      {
        // De representatie van /p/:id hangt af van de Accept-header (zie rewrites).
        source: "/p/:publicId",
        headers: [{ key: "Vary", value: "Accept" }]
      }
    ];
  },
  poweredByHeader: false
};

export default nextConfig;
