// Rolmodel: precies één platform_owner (Robert, het geseede break-glass-account),
// company_admin per bedrijf, company_user (UI-naam: Productmedewerker). Publieke
// QR-bezoekers hebben geen account en geen rol. Singulariteit van de Platform Owner
// wordt op applicatieniveau afgedwongen: geen enkel API-pad accepteert deze rol bij
// aanmaken of wijzigen, en het seed-script werkt alleen zijn eigen account bij.
const PLATFORM_OWNER_ROLES = ["platform_owner"];

// Rollen die via de API toegekend mogen worden (platform_owner dus bewust niet).
const ASSIGNABLE_ROLES = ["company_admin", "company_user"];

function isPlatformOwner(role) {
  return PLATFORM_OWNER_ROLES.includes(role);
}

module.exports = { PLATFORM_OWNER_ROLES, ASSIGNABLE_ROLES, isPlatformOwner };
