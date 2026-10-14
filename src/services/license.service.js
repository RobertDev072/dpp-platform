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
// Een medewerker krijgt geen abonnementsdetails (plan, aantallen); alleen dat de actie
// niet kan en wie hem kan helpen. Beheerders krijgen de reden en wat ze kunnen doen.
const EMPLOYEE_BLOCKED =
  "Dit kan op dit moment niet vanwege het abonnement van je bedrijf. Neem contact op met je bedrijfsbeheerder.";

function isAdminRole(role) {
  return role === "company_admin" || role === "partner_admin" || role === "platform_owner" || role == null;
}

// kind: "product" | "user". extra: aantal dat erbij komt (bijv. heractiveren van meerdere
// gearchiveerde producten tegelijk). role: rol van de aanvrager (bepaalt de melding).
async function assertCanCreate(companyId, kind, { role = null, extra = 1 } = {}) {
  const usage = await getLicenseUsage(companyId);
  if (!usage) {
    throw new HttpError(404, "Niet gevonden");
  }
  const admin = isAdminRole(role);
  if (usage.status === STATUS.EXPIRED) {
    throw new HttpError(
      409,
      admin
        ? "Het abonnement van dit bedrijf is verlopen, daarom kunnen er geen producten of gebruikers worden toegevoegd. Neem contact op met VeriPasso of je partner om te verlengen."
        : EMPLOYEE_BLOCKED,
      undefined,
      "LICENSE_EXPIRED"
    );
  }
  if (kind === "product" && usage.products.max != null && usage.products.used + extra > usage.products.max) {
    throw new HttpError(
      409,
      admin
        ? `Productlimiet van het abonnement bereikt (${usage.products.used}/${usage.products.max} actieve producten). Archiveer producten die niet meer nodig zijn, of neem contact op met VeriPasso of je partner om het abonnement te wijzigen.`
        : EMPLOYEE_BLOCKED,
      undefined,
      "LICENSE_LIMIT_REACHED"
    );
  }
  if (kind === "user" && usage.users.max != null && usage.users.used + extra > usage.users.max) {
    throw new HttpError(
      409,
      admin
        ? `Gebruikerslimiet van het abonnement bereikt (${usage.users.used}/${usage.users.max} actieve gebruikers). Deactiveer een gebruiker of neem contact op met VeriPasso of je partner.`
        : EMPLOYEE_BLOCKED,
      undefined,
      "LICENSE_LIMIT_REACHED"
    );
  }
}

// Controle + aanmaken als één ondeelbare stap per bedrijf: gelijktijdige verzoeken
// (dubbelklik, twee tabbladen, scripts) wachten op elkaar, zodat de limiet nooit
// overschreden wordt. PostgreSQL-adviesvergrendeling op (namespace, bedrijfs-id).
const CREATION_LOCK_NAMESPACE = 7301;

async function withCreationLock(companyId, fn) {
  const { getPool } = require("../config/db");
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [CREATION_LOCK_NAMESPACE, companyId]);
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [CREATION_LOCK_NAMESPACE, companyId]).catch(() => {});
    client.release();
  }
}

module.exports = { STATUS, buildUsage, getLicenseUsage, assertCanCreate, withCreationLock };
