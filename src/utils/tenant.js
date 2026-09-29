const { HttpError } = require("../middleware/errorHandler");
const { isPlatformOwner } = require("./roles");

// Geeft nooit een 403 voor cross-tenant toegang: dat zou aan een aanvaller
// bevestigen dat de record bij een ander bedrijf bestaat. Een 404 laat dat niet zien.
function assertCompanyAccess(user, companyId) {
  if (isPlatformOwner(user.role)) {
    return;
  }

  if (user.companyId == null || user.companyId !== companyId) {
    throw new HttpError(404, "Niet gevonden");
  }
}

module.exports = { assertCompanyAccess };
