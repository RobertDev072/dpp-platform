// Numerieke routeparameters (:id e.d.): een waarde die geen positief geheel getal is,
// slaat deze route over (next("route")). Zo eindigt bijv. /api/products/abc in de gewone
// 404 in plaats van een databasefout (500), en blijven letterlijke routes (/qr-stats) werken.
function numericParam(router, ...names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (/^[1-9]\d{0,9}$/.test(String(value))) {
        next();
        return;
      }
      next("route");
    });
  }
}

module.exports = { numericParam };
