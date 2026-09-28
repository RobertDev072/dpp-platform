const usersRepo = require("../repositories/users.repository");

class EntraLoginError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
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
async function resolveEntraLogin({ sub, email }) {
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

module.exports = { resolveEntraLogin, EntraLoginError };
