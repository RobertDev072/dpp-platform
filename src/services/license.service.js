const companiesRepo = require("../repositories/companies.repository");
const plansRepo = require("../repositories/plans.repository");
const usersRepo = require("../repositories/users.repository");
const productsRepo = require("../repositories/products.repository");
const { HttpError } = require("../middleware/errorHandler");

// Eén bron van waarheid voor licentiegebruik en -status. Alle tellingen zijn strikt
// per bedrijf (tenant-geïsoleerd): bedrijven op hetzelfde plan hebben elk hun eigen
// limieten en verbruik - er wordt nooit iets opgeteld over tenants heen.

const STATUS = {
  EXPIRED: "Verlopen",
  LIMIT_REACHED: "Limiet bereikt",
  NEAR_LIMIT: "Bijna limiet",
  ACTIVE: "Actief"
};

function pct(used, max) {
  if (max == null || max <= 0) return null;
  return Math.min(100, Math.round((used / max) * 100));
}

function isExpired(licenseEnd) {
  if (!licenseEnd) return false;
  const end = new Date(licenseEnd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

// Berekent gebruik + status uit al opgehaalde tellingen (geen queries) - gebruikt
// door zowel getLicenseUsage als het owner-overzicht dat alles in één query laadt.
function buildUsage({ plan, licenseStart, licenseEnd, usersUsed, productsUsed }) {
  const users = { used: usersUsed, max: plan ? plan.max_users : null, pct: pct(usersUsed, plan?.max_users) };
  const products = {
    used: productsUsed,
    max: plan ? plan.max_products : null,
    pct: pct(productsUsed, plan?.max_products)
  };

  let status = STATUS.ACTIVE;
  if (isExpired(licenseEnd)) {
    status = STATUS.EXPIRED;
  } else if ((users.max != null && users.used >= users.max) || (products.max != null && products.used >= products.max)) {
    status = STATUS.LIMIT_REACHED;
  } else if ((users.pct ?? 0) >= 80 || (products.pct ?? 0) >= 80) {
    status = STATUS.NEAR_LIMIT;
  }

  return {
    plan: plan ? { id: plan.id, name: plan.name } : null,
    licenseStart: licenseStart || null,
    licenseEnd: licenseEnd || null,
    users,
    products,
    status
  };
}

async function getLicenseUsage(companyId) {
  const company = await companiesRepo.getCompanyById(companyId);
  if (!company) return null;

  const [plan, usersUsed, productsUsed] = await Promise.all([
    company.plan_id ? plansRepo.getPlanById(company.plan_id) : null,
    usersRepo.countActiveUsers(companyId),
    productsRepo.countProductsForCompany(companyId)
  ]);

  return buildUsage({
    plan,
    licenseStart: company.license_start,
    licenseEnd: company.license_end,
    usersUsed,
    productsUsed
  });
}

// Afdwinging bij aanmaken. Verlopen licentie blokkeert elk aanmaken; limieten
// blokkeren alleen de eigen resource-soort. Bestaande data en publieke
// QR-paspoorten blijven altijd werken (bewuste keuze van de Platform Owner).
async function assertCanCreate(companyId, kind) {
  const usage = await getLicenseUsage(companyId);
  if (!usage) {
    throw new HttpError(404, "Niet gevonden");
  }
  if (usage.status === STATUS.EXPIRED) {
    throw new HttpError(
      409,
      "De licentie van dit bedrijf is verlopen. Neem contact op met de beheerder om te verlengen.",
      undefined,
      "LICENSE_EXPIRED"
    );
  }
  if (kind === "product" && usage.products.max != null && usage.products.used >= usage.products.max) {
    throw new HttpError(
      409,
      `Productlimiet bereikt (${usage.products.used}/${usage.products.max}). Upgrade het licentieplan of archiveer producten.`,
      undefined,
      "LICENSE_LIMIT_REACHED"
    );
  }
  if (kind === "user" && usage.users.max != null && usage.users.used >= usage.users.max) {
    throw new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED");
  }
}

module.exports = { STATUS, buildUsage, getLicenseUsage, assertCanCreate };
