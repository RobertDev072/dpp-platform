// Uitgefaseerd: de app draaide op Azure als één Node-proces (Express + Next.js).
// Op Vercel draait Next.js zelf en zit de Express-API in pages/api/[[...path]].js.
// Lokaal: `npm run dev` (ontwikkelen) of `npm run build && npm start`.
// Dit bestand kan weg.
console.error("server.js is uitgefaseerd. Gebruik `npm run dev` of `npm run build && npm start`.");
process.exit(1);
