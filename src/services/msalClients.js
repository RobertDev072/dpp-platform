const msal = require("@azure/msal-node");
const { getEntraConfig, isEntraGraphConfigured } = require("../config/entra");

let webClient;
let daemonClient;
let cachedAuthorityMetadata;

// MSAL Node's eigen interne fetch naar de OIDC discovery-endpoint faalt stil op deze
// Node-versie (bevestigd: dezelfde URL is met een gewone fetch/curl prima bereikbaar).
// authorityMetadata is een door Microsoft zelf gedocumenteerde optie om dat
// discovery-document zelf op te halen en aan MSAL te geven, zodat die interne call
// wordt overgeslagen. Eenmalig opgehaald en hergebruikt voor beide clients.
async function getAuthorityMetadata(entra) {
  if (!cachedAuthorityMetadata) {
    const response = await fetch(`${entra.authority}/v2.0/.well-known/openid-configuration`);
    if (!response.ok) {
      throw new Error(`Kon Entra OIDC-configuratie niet ophalen (${response.status})`);
    }
    cachedAuthorityMetadata = await response.text();
  }
  return cachedAuthorityMetadata;
}

async function getWebConfidentialClient() {
  if (!webClient) {
    const entra = getEntraConfig();
    webClient = new msal.ConfidentialClientApplication({
      auth: {
        clientId: entra.web.clientId,
        authority: entra.authority,
        clientSecret: entra.web.clientSecret,
        knownAuthorities: [entra.ciamHost],
        authorityMetadata: await getAuthorityMetadata(entra)
      }
    });
  }
  return webClient;
}

async function getDaemonConfidentialClient() {
  if (!daemonClient) {
    if (!isEntraGraphConfigured()) {
      throw new Error("Entra Graph-daemon is niet geconfigureerd (ENTRA_GRAPH_CLIENT_ID/SECRET ontbreken).");
    }
    const entra = getEntraConfig();
    daemonClient = new msal.ConfidentialClientApplication({
      auth: {
        clientId: entra.graph.clientId,
        authority: entra.authority,
        clientSecret: entra.graph.clientSecret,
        knownAuthorities: [entra.ciamHost],
        authorityMetadata: await getAuthorityMetadata(entra)
      }
    });
  }
  return daemonClient;
}

module.exports = { getWebConfidentialClient, getDaemonConfidentialClient };
