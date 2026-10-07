/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
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
    "@supabase/supabase-js"
  ],
  // pdfkit leest zijn standaardfonts (Helvetica.afm) van schijf voor het QR-label.
  outputFileTracingIncludes: {
    "/api/[[...path]]": ["./node_modules/pdfkit/js/data/**"]
  },
  // Standaard beveiligingsheaders op elke response (HSTS zet Vercel zelf al).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" }
        ]
      }
    ];
  },
  poweredByHeader: false
};

export default nextConfig;
