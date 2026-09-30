// Rolmodel: precies één platform_owner (Robert, het geseede break-glass-account),
// company_admin per bedrijf, company_user (UI-naam: Productmedewerker). Publieke
// QR-bezoekers hebben geen account en geen rol. Singulariteit van de Platform Owner
// wordt op applicatieniveau afgedwongen: geen enkel API-pad accepteert deze rol bij
// aanmaken of wijzigen, en het seed-script werkt alleen zijn eigen account bij.
const PLATFORM_OWNER_ROLES = ["platform_owner"];

// Rollen die via de API toegekend mogen worden (platform_owner dus bewust niet;
// partner_admin alleen door de Platform Owner en alleen op partnerbedrijven -
// die extra guard zit in users.routes).
const ASSIGNABLE_ROLES = ["company_admin", "company_user"];
const PARTNER_ROLES = ["partner_admin"];
const OWNER_ASSIGNABLE_ROLES = [...ASSIGNABLE_ROLES, ...PARTNER_ROLES];

function isPlatformOwner(role) {
  return PLATFORM_OWNER_ROLES.includes(role);
}

function isPartnerAdmin(role) {
  return PARTNER_ROLES.includes(role);
}

module.exports = {
  PLATFORM_OWNER_ROLES,
  ASSIGNABLE_ROLES,
  PARTNER_ROLES,
  OWNER_ASSIGNABLE_ROLES,
  isPlatformOwner,
  isPartnerAdmin
};
