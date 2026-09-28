const usersRepo = require("../repositories/users.repository");
const { ROLES } = require("../auth/permissions");

class EntraLoginError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Startpagina na inloggen. Eén plek, zodat lokale login (redirectTo in de JSON) en de
// Entra-callback (302) altijd naar dezelfde omgeving sturen.
function getHomePathForRole(role) {
  return role === ROLES.SYSTEM_OWNER ? "/admin/index.html" : "/app/index.html";
}

// Zuivere functie, losgekoppeld van de MSAL/OIDC-redirect-dans: neemt claims die MSAL al
// cryptografisch heeft geverifieerd (sub, email) en bepaalt welke DPP-user dit is.
// Daardoor is dit los te testen zonder een echte Entra-tenant nodig te hebben.
//
// Volgorde:
//   1. Al eerder gekoppeld? Zoek direct op entra_subject_id (het normale herhaalbezoek-pad).
//   2. Nog niet gekoppeld? Eenmalige "just-in-time"-koppeling op basis van het e-mailadres
//      dat een admin al in DPP heeft aangemaakt (entra_subject_id IS NULL, status=active).
//   3. Geen van beide? Deze Entra-identiteit heeft geen bijbehorend DPP-account.
// Daarna: de company moet actief zijn (behalve voor de system_owner, die bij geen company hoort).
async function resolveEntraLogin({ sub, email }) {
  const user = await resolveLinkedUser({ sub, email });
  await assertCompanyActive(user);
  return user;
}

async function resolveLinkedUser({ sub, email }) {
  if (!sub) {
    throw new EntraLoginError("MISSING_SUB", "ID-token bevat geen sub-claim");
  }

  const alreadyLinked = await usersRepo.getUserByEntraSubjectId(sub);
  if (alreadyLinked) {
    if (alreadyLinked.status !== "active") {
      throw new EntraLoginError("INACTIVE", "Account is gedeactiveerd");
    }
    return alreadyLinked;
  }

  if (!email) {
    throw new EntraLoginError("NO_LINKED_ACCOUNT", "Geen DPP-account gekoppeld aan deze identiteit");
  }

  const unlinked = await usersRepo.getUnlinkedUserByEmail(email);
  if (!unlinked) {
    throw new EntraLoginError("NO_LINKED_ACCOUNT", "Geen DPP-account gekoppeld aan deze identiteit");
  }

  const linked = await usersRepo.linkEntraSubjectId(unlinked.id, sub);
  if (linked) {
    return linked;
  }

  // Race verloren: een gelijktijdige login heeft deze rij net gekoppeld. Die koppeling
  // betreft dezelfde sub, dus opnieuw opzoeken op sub geeft het juiste (nu al gekoppelde) resultaat.
  const resolvedByWinner = await usersRepo.getUserByEntraSubjectId(sub);
  if (resolvedByWinner) {
    return resolvedByWinner;
  }

  throw new EntraLoginError("LINK_FAILED", "Koppelen van Entra-identiteit is mislukt, probeer opnieuw");
}

// Zelfde regel als getUserForToken: gebruikers van een suspended/archived company komen er
// niet in. Hier al weigeren i.p.v. een sessie aan te maken die direct ongeldig is, zodat
// de loginpagina een begrijpelijke melding ("inactive") kan tonen.
async function assertCompanyActive(user) {
  if (user.role === ROLES.SYSTEM_OWNER) {
    return;
  }
  const company = user.company_id != null ? await usersRepo.getCompanyStatus(user.company_id) : null;
  if (!company || company.status !== "active") {
    throw new EntraLoginError("COMPANY_INACTIVE", "Het bedrijf van dit account is niet actief");
  }
}

// Vaste mapping naar de foutcodes die /login.html kent. Nooit de ruwe foutmelding in de
// URL: die kan details bevatten die niet in browsergeschiedenis/logs thuishoren.
const LOGIN_ERROR_CODES = Object.freeze({
  MISSING_SUB: "login_failed",
  LINK_FAILED: "login_failed",
  NO_LINKED_ACCOUNT: "no_account",
  INACTIVE: "inactive",
  COMPANY_INACTIVE: "inactive"
});

function getLoginErrorCode(error) {
  if (error instanceof EntraLoginError && LOGIN_ERROR_CODES[error.code]) {
    return LOGIN_ERROR_CODES[error.code];
  }
  return "login_failed";
}

module.exports = { resolveEntraLogin, EntraLoginError, getHomePathForRole, getLoginErrorCode };
