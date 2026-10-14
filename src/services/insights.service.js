const productsRepo = require("../repositories/products.repository");
const documentsRepo = require("../repositories/documents.repository");
const scanEventsRepo = require("../repositories/scanEvents.repository");
const companiesRepo = require("../repositories/companies.repository");
const { getLicenseUsage, STATUS } = require("./license.service");

// Afgeleide inzichten per bedrijf: dashboard, onboarding-checklist en meldingen.
// Alles komt uit bestaande data (geen extra tabellen, geen fictieve cijfers) en is
// strikt per companyId.

function fillDays(rows, days) {
  const byDay = new Map(rows.map((r) => [r.day, r.total]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, total: byDay.get(key) || 0 });
  }
  return out;
}

function buildOnboarding({ company, stats, documents }) {
  const steps = [
    {
      key: "profile",
      label: "Bedrijfsprofiel compleet",
      description: "Bedrijfsnaam en logo instellen",
      done: Boolean(company?.name && company?.logo),
      href: "/company/instellingen"
    },
    { key: "product", label: "Eerste product aangemaakt", description: "Handmatig aanmaken", done: stats.total > 0, href: "/company/products?new=1" },
    { key: "complete", label: "Product compleet gemaakt", description: "Alle paspoortgegevens 100% ingevuld", done: stats.complete > 0, href: "/company/products?doc=incompleet" },
    { key: "published", label: "Eerste QR gepubliceerd", description: "Paspoort openbaar via de QR-code", done: stats.published + stats.archived > 0 && stats.qrActive > 0, href: "/company/qr-codes" },
    { key: "document", label: "Eerste document toegevoegd", description: "Handleiding, certificaat of verklaring", done: documents.total > 0, href: "/company/documenten" }
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, pct: Math.round((done / steps.length) * 100) };
}

function buildActions({ stats, documents }) {
  const actions = [];
  const push = (key, severity, count, title, href) => {
    if (count > 0) actions.push({ key, severity, count, title, href });
  };
  push("expired_documents", "error", documents.expired, `${documents.expired === 1 ? "document is" : "documenten zijn"} verlopen`, "/company/documenten?validity=expired");
  // Gearchiveerde producten tellen niet mee: daar wordt niet meer aan gewerkt.
  const incomplete = stats.total - stats.archived - stats.complete;
  push("incomplete", "warning", incomplete, `${incomplete === 1 ? "product is" : "producten zijn"} incompleet`, "/company/products?doc=incompleet");
  push("missing_documents", "warning", stats.missing.documents, `${stats.missing.documents === 1 ? "product mist" : "producten missen"} documenten`, "/company/products?missing=documents");
  push("expiring_documents", "warning", documents.expiring, `${documents.expiring === 1 ? "document verloopt" : "documenten verlopen"} binnen 30 dagen`, "/company/documenten?validity=expiring");
  push("ready_to_publish", "info", stats.readyToPublish, `${stats.readyToPublish === 1 ? "product is" : "producten zijn"} compleet maar nog niet gepubliceerd`, "/company/products?status=draft&doc=compleet");
  push("qr_reserved", "info", stats.qrReserved, `QR-${stats.qrReserved === 1 ? "code is" : "codes zijn"} nog niet actief (product niet gepubliceerd)`, "/company/qr-codes?qr=reserved");
  push("missing_photo", "info", stats.missing.photo, `${stats.missing.photo === 1 ? "product heeft" : "producten hebben"} geen foto`, "/company/products?missing=photo");
  return actions;
}

// Contextuele tips (maximaal twee, alleen als ze iets zeggen).
function buildRecommendations({ stats, documents }) {
  const tips = [];
  const live = stats.total - stats.archived;
  if (live >= 5 && stats.missing.documents / live >= 0.5) {
    tips.push({ tone: "info", text: `${Math.round((stats.missing.documents / live) * 100)}% van je producten heeft nog geen document.`, href: "/company/products?missing=documents" });
  }
  if (documents.expired > 0) {
    tips.push({ tone: "warning", text: `${documents.expired} ${documents.expired === 1 ? "document is" : "documenten zijn"} verlopen; vernieuw ze om je paspoorten actueel te houden.`, href: "/company/documenten?validity=expired" });
  }
  return tips.slice(0, 2);
}

// role: abonnementsgegevens (plan, limieten, verbruik) alleen voor de bedrijfsbeheerder;
// een medewerker krijgt ze niet, ook niet via de API.
async function getCompanyOverview(companyId, { days = 30, role = "company_user" } = {}) {
  const [company, stats, scans, scanRows, createdRows, categories, documents, recent, topScanned, license] =
    await Promise.all([
      companiesRepo.getCompanyById(companyId),
      productsRepo.getProductStats({ companyId }),
      scanEventsRepo.getScanSummary(companyId),
      scanEventsRepo.countScansPerDay(companyId, days),
      productsRepo.countCreatedPerDay(companyId, days),
      productsRepo.countByCategory(companyId),
      documentsRepo.getDocumentStats(companyId),
      productsRepo.listRecentlyUpdated(companyId, 6),
      scanEventsRepo.listTopScannedProducts(companyId, { limit: 5, days }),
      role === "company_admin" ? getLicenseUsage(companyId) : null
    ]);

  return {
    company: company ? { id: company.id, name: company.name, hasLogo: Boolean(company.logo) } : null,
    stats,
    scans: { ...scans, series: fillDays(scanRows, days), days },
    createdSeries: fillDays(createdRows, days),
    categories,
    documents,
    recentProducts: recent.items,
    topScanned,
    license,
    onboarding: buildOnboarding({ company, stats, documents }),
    actions: buildActions({ stats, documents }),
    recommendations: buildRecommendations({ stats, documents })
  };
}

// Meldingen voor het belletje. Live berekend; elke melding heeft een stabiele id
// (type + aantal), zodat de client "gelezen" kan onthouden tot er iets verandert.
async function getCompanyNotifications(companyId, { role = "company_user" } = {}) {
  const [stats, documents, license] = await Promise.all([
    productsRepo.getProductStats({ companyId }),
    documentsRepo.getDocumentStats(companyId),
    // Abonnementsmeldingen alleen voor de bedrijfsbeheerder.
    role === "company_admin" ? getLicenseUsage(companyId) : null
  ]);
  const items = buildActions({ stats, documents })
    .filter((a) => a.key !== "missing_photo")
    .map((a) => ({ id: `${a.key}:${a.count}`, severity: a.severity, title: `${a.count} ${a.title}`, href: a.href }));

  if (license) {
    const maxPct = Math.max(license.users.pct ?? 0, license.products.pct ?? 0);
    if (license.status === STATUS.EXPIRED) {
      items.unshift({ id: "license:expired", severity: "error", title: "Je abonnement is verlopen", description: "Nieuwe producten en gebruikers aanmaken is geblokkeerd.", href: "/company/abonnement" });
    } else if (license.status === STATUS.LIMIT_REACHED) {
      items.unshift({ id: "license:limit", severity: "error", title: "Limiet van je abonnement bereikt", description: `Producten ${license.products.used}/${license.products.max ?? "∞"}, gebruikers ${license.users.used}/${license.users.max ?? "∞"}.`, href: "/company/abonnement" });
    } else if (maxPct >= 80) {
      items.unshift({ id: `license:near:${maxPct}`, severity: "warning", title: `Je gebruikt ${maxPct}% van je abonnement`, href: "/company/abonnement" });
    }
  }

  return items;
}

module.exports = { getCompanyOverview, getCompanyNotifications, buildOnboarding };
