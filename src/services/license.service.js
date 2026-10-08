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

// Uitgebreid gebruik voor abonnementspagina's: naast producten/gebruikers ook
// opslag en QR-scans deze maand, prijs en waarschuwingen (≥ 80% = bijna limiet).
// Opslag en scans zijn informatief: ze blokkeren niets (geen QR-code mag ooit
// stoppen met werken door een scanlimiet).
async function getExtendedUsage(companyId) {
  const base = await getLicenseUsage(companyId);
  if (!base) return null;
  const { queryOne } = require("../config/db");
  const row = await queryOne(
    `SELECT pl.price_monthly_cents, pl.max_storage_mb, pl.max_scans_month,
            (SELECT COALESCE(SUM(file_size::bigint), 0) FROM documents WHERE company_id = c.id) AS storage_bytes,
            (SELECT COUNT(*) FROM scan_events s JOIN products p ON p.id = s.product_id
              WHERE p.company_id = c.id AND s.scanned_at >= date_trunc('month', now())) AS scans_month
     FROM companies c LEFT JOIN plans pl ON pl.id = c.plan_id WHERE c.id = $1`,
    [companyId]
  );
  const storageUsed = Number(row.storage_bytes || 0);
  const storageMax = row.max_storage_mb != null ? Number(row.max_storage_mb) * 1024 * 1024 : null;
  const scansUsed = Number(row.scans_month || 0);
  const scansMax = row.max_scans_month != null ? Number(row.max_scans_month) : null;
  const storage = { used: storageUsed, max: storageMax, pct: pct(storageUsed, storageMax) };
  const scans = { used: scansUsed, max: scansMax, pct: pct(scansUsed, scansMax) };

  const warnings = [];
  const check = (label, metric) => {
    if (metric.pct == null) return;
    if (metric.pct >= 100) warnings.push({ level: "danger", message: `${label}: limiet bereikt` });
    else if (metric.pct >= 80) warnings.push({ level: "warning", message: `${label}: ${metric.pct}% gebruikt` });
  };
  check("Producten", base.products);
  check("Gebruikers", base.users);
  check("Opslag", storage);
  check("QR-scans deze maand", scans);
  if (base.status === STATUS.EXPIRED) warnings.unshift({ level: "danger", message: "De licentie is verlopen" });
  if (base.licenseEnd && base.status !== STATUS.EXPIRED) {
    const days = Math.ceil((new Date(base.licenseEnd) - new Date()) / 86400000);
    if (days <= 30) warnings.push({ level: "warning", message: `Licentie verloopt over ${days} dag${days === 1 ? "" : "en"}` });
  }

  return {
    ...base,
    priceMonthlyCents: row.price_monthly_cents != null ? Number(row.price_monthly_cents) : null,
    storage,
    scans,
    warnings
  };
}

module.exports = { STATUS, buildUsage, getLicenseUsage, getExtendedUsage, assertCanCreate };
