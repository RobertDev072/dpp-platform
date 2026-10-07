// Microsoft Entra External ID is UITGEFASEERD. Alle wachtwoorden staan voortaan
// lokaal (bcrypt in Postgres). Accounts die nog in Entra zijn aangemaakt hebben geen
// lokale hash; zolang onderstaande twee variabelen gezet zijn, controleert de login
// hun wachtwoord nog één keer bij Entra (Native Authentication, alleen client-id
// nodig - geen secrets, geen Graph) en slaat het daarna lokaal op. Zo worden
// bestaande gebruikers bij hun eerstvolgende login ongemerkt overgezet.
//
// Zodra (bijna) iedereen is overgezet: beide variabelen weghalen en de rest een
// tijdelijk wachtwoord geven (scripts/issue-temp-passwords.js). Daarna kan de
// Entra-tenant weg.
const LEGACY_VARS = ["ENTRA_TENANT_NAME", "ENTRA_WEB_CLIENT_ID"];

function missing(vars) {
  return vars.filter((name) => !process.env[name]);
}

function isLegacyEntraConfigured() {
  return missing(LEGACY_VARS).length === 0;
}

function getEntraConfig() {
  if (!isLegacyEntraConfigured()) {
    throw new Error(`Entra-overgangslogin is niet geconfigureerd. Ontbrekende env vars: ${missing(LEGACY_VARS).join(", ")}`);
  }

  const tenantName = process.env.ENTRA_TENANT_NAME;
  const tenantDomain = `${tenantName}.onmicrosoft.com`;
  const ciamHost = `${tenantName}.ciamlogin.com`;

  return {
    tenantDomain,
    ciamHost,
    authority: `https://${ciamHost}/${tenantDomain}`,
    web: { clientId: process.env.ENTRA_WEB_CLIENT_ID }
  };
}

// Voor het config-diagnose-endpoint: alleen niet-geheime identifiers.
function getEntraConfigDiagnostics() {
  return {
    legacyLoginConfigured: isLegacyEntraConfigured(),
    missingVars: missing(LEGACY_VARS),
    tenantName: process.env.ENTRA_TENANT_NAME || null,
    webClientId: process.env.ENTRA_WEB_CLIENT_ID || null
  };
}

module.exports = {
  isLegacyEntraConfigured,
  getEntraConfig,
  getEntraConfigDiagnostics
};
