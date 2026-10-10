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
    "@aws-sdk/s3-presigned-post",
    "@aws-sdk/s3-request-presigner",
    "@aws-sdk/client-secrets-manager"
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
  // Standaard beveiligingsheaders op elke response. HSTS ook hier (naast CloudFront),
  // zodat de policy niet afhangt van één laag.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
