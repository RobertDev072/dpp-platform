// Bewust in twee losse groepen: de login-flow (dit app-registratie: "Web") kan al
// werken voordat de Graph-daemon-registratie (voor user-provisioning) bestaat. Dat
// matcht de gefaseerde Azure-setup (eerst inloggen testen, later provisioning).
const LOGIN_VARS = [
  "ENTRA_TENANT_NAME",
  "ENTRA_TENANT_ID",
  "ENTRA_WEB_CLIENT_ID",
  "ENTRA_WEB_CLIENT_SECRET",
  "ENTRA_REDIRECT_URI",
  "ENTRA_POST_LOGOUT_REDIRECT_URI",
  "COOKIE_SECRET"
];

const GRAPH_VARS = ["ENTRA_TENANT_NAME", "ENTRA_TENANT_ID", "ENTRA_GRAPH_CLIENT_ID", "ENTRA_GRAPH_CLIENT_SECRET"];

function missing(vars) {
  return vars.filter((name) => !process.env[name]);
}

function isEntraLoginConfigured() {
  return missing(LOGIN_VARS).length === 0;
}

function isEntraGraphConfigured() {
  return missing(GRAPH_VARS).length === 0;
}

// "Volledig" geconfigureerd = zowel inloggen als user-provisioning werken. Gebruikt door
// users.routes.js om te beslissen of nieuwe medewerkers via Entra worden aangemaakt.
function isEntraConfigured() {
  return isEntraLoginConfigured() && isEntraGraphConfigured();
}

function getEntraConfig() {
  if (!isEntraLoginConfigured()) {
    throw new Error(
      `Entra login is niet (volledig) geconfigureerd. Ontbrekende env vars: ${missing(LOGIN_VARS).join(", ")}`
    );
  }

  const tenantName = process.env.ENTRA_TENANT_NAME;
  const tenantDomain = `${tenantName}.onmicrosoft.com`;
  const ciamHost = `${tenantName}.ciamlogin.com`;
  const authority = `https://${ciamHost}/${tenantDomain}`;

  return {
    tenantId: process.env.ENTRA_TENANT_ID,
    tenantDomain,
    ciamHost,
    authority,
    redirectUri: process.env.ENTRA_REDIRECT_URI,
    postLogoutRedirectUri: process.env.ENTRA_POST_LOGOUT_REDIRECT_URI,
    web: {
      clientId: process.env.ENTRA_WEB_CLIENT_ID,
      clientSecret: process.env.ENTRA_WEB_CLIENT_SECRET
    },
    graph: isEntraGraphConfigured()
      ? {
          clientId: process.env.ENTRA_GRAPH_CLIENT_ID,
          clientSecret: process.env.ENTRA_GRAPH_CLIENT_SECRET
        }
      : null,
    logoutEndpoint: `${authority}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(
      process.env.ENTRA_POST_LOGOUT_REDIRECT_URI || ""
    )}`
  };
}

// Voor het config-diagnose-endpoint: alleen NIET-geheime identifiers (tenant-naam/-id
// en client-id's zijn publieke identifiers; secrets worden alleen als aanwezig/afwezig
// gerapporteerd, nooit als waarde).
function getEntraConfigDiagnostics() {
  return {
    loginConfigured: isEntraLoginConfigured(),
    graphConfigured: isEntraGraphConfigured(),
    missingLoginVars: missing(LOGIN_VARS),
    missingGraphVars: missing(GRAPH_VARS),
    tenantName: process.env.ENTRA_TENANT_NAME || null,
    tenantId: process.env.ENTRA_TENANT_ID || null,
    webClientId: process.env.ENTRA_WEB_CLIENT_ID || null,
    graphClientId: process.env.ENTRA_GRAPH_CLIENT_ID || null,
    webClientSecretSet: Boolean(process.env.ENTRA_WEB_CLIENT_SECRET),
    graphClientSecretSet: Boolean(process.env.ENTRA_GRAPH_CLIENT_SECRET)
  };
}

module.exports = {
  isEntraConfigured,
  isEntraLoginConfigured,
  isEntraGraphConfigured,
  getEntraConfig,
  getEntraConfigDiagnostics
};
