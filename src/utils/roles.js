// Overgangslaag voor de hernoeming system_owner -> platform_owner (migratie 007).
// Zolang de productie-database nog de oude rolnaam bevat, geven beide namen dezelfde
// rechten - zo kan de code vóór de datamigratie live, en breekt de login op geen
// enkel moment. Na migratie 007 + de opschoningscommit verdwijnt "system_owner"
// hieruit definitief.
const PLATFORM_OWNER_ROLES = ["platform_owner", "system_owner"];

function isPlatformOwner(role) {
  return PLATFORM_OWNER_ROLES.includes(role);
}

module.exports = { PLATFORM_OWNER_ROLES, isPlatformOwner };
