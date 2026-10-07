/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  // Server-only packages die Node-API's/eigen bestanden gebruiken: niet bundelen maar
  // als gewone node_modules meenemen in de Vercel Function (pdfkit leest zijn
  // fontbestanden van schijf, pg heeft optionele native bindings).
  serverExternalPackages: ["pdfkit", "pg", "express", "bcryptjs", "qrcode"],
  // pdfkit laadt de standaardfonts (Helvetica e.d.) at runtime van schijf; zorg dat
  // die in de API-function terechtkomen (QR-label-PDF).
  outputFileTracingIncludes: {
    "/api/[...path]": ["./node_modules/pdfkit/js/data/**/*"]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" }
        ]
      }
    ];
  }
};

export default nextConfig;
