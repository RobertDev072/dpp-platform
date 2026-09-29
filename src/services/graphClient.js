const { getDaemonConfidentialClient } = require("./msalClients");
const { getEntraConfig } = require("../config/entra");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = ["https://graph.microsoft.com/.default"];

async function getAppOnlyToken() {
  const client = await getDaemonConfidentialClient();
  const result = await client.acquireTokenByClientCredential({ scopes: GRAPH_SCOPE });
  return result.accessToken;
}

async function graphRequest(method, path, body) {
  const token = await getAppOnlyToken();
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Microsoft Graph ${method} ${path} mislukt (${response.status}): ${errorBody}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// Maakt een lokaal (email+wachtwoord) account aan in de Entra External ID-tenant.
// Vereist Graph application permission: User.Create (+ User-PasswordProfile.ReadWrite.All
// voor het zetten van passwordProfile bij aanmaak — te verifiëren in een dev-tenant).
async function createEntraUser({ email, displayName, tempPassword }) {
  const entra = getEntraConfig();

  const user = await graphRequest("POST", "/users", {
    accountEnabled: true,
    displayName: displayName || email,
    identities: [
      {
        signInType: "emailAddress",
        issuer: entra.tenantDomain,
        issuerAssignedId: email
      }
    ],
    passwordProfile: {
      password: tempPassword,
      forceChangePasswordNextSignIn: true
    },
    passwordPolicies: "DisablePasswordExpiration"
  });

  return { entraObjectId: user.id };
}

// Vereist: User.EnableDisableAccount.All
async function setAccountEnabled(entraObjectId, enabled) {
  await graphRequest("PATCH", `/users/${encodeURIComponent(entraObjectId)}`, {
    accountEnabled: enabled
  });
}

// Vereist: User-PasswordProfile.ReadWrite.All. Bewuste, smalle fallback naast SSPR —
// zie docs/entra-external-id-setup.md voor de afweging.
async function resetPassword(entraObjectId, newTempPassword) {
  await graphRequest("PATCH", `/users/${encodeURIComponent(entraObjectId)}`, {
    passwordProfile: {
      password: newTempPassword,
      forceChangePasswordNextSignIn: true
    }
  });
}

// Vereist: User.DeleteRestore.All (of User.ReadWrite.All). Verwijdert het Entra-account
// definitief - status "deleted" in de SaaS is dus niet zomaar terug te draaien zoals
// blocked/suspended/archived dat wel zijn (die schakelen alleen accountEnabled om).
async function deleteEntraUser(entraObjectId) {
  await graphRequest("DELETE", `/users/${encodeURIComponent(entraObjectId)}`);
}

module.exports = { createEntraUser, setAccountEnabled, resetPassword, deleteEntraUser };
