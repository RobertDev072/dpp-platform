// Centrale permissielaag. Routes checken permissies (requirePermission), niet rolnamen:
// zo staat "wie mag wat" op één plek en kan een rol later worden bijgesteld zonder door
// alle routes heen te hoeven. De frontend krijgt dezelfde lijst via /api/auth/me, maar
// gebruikt die alleen om menu's/knoppen te verbergen — de backend blijft autoritatief.

const ROLES = Object.freeze({
  SYSTEM_OWNER: "system_owner",
  COMPANY_ADMIN: "company_admin",
  PRODUCT_MANAGER: "product_manager",
  COMPLIANCE_MANAGER: "compliance_manager",
  COMPANY_USER: "company_user",
  VIEWER: "viewer"
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

// Rollen die bij precies één company horen.
const COMPANY_ROLES = Object.freeze([
  ROLES.COMPANY_ADMIN,
  ROLES.PRODUCT_MANAGER,
  ROLES.COMPLIANCE_MANAGER,
  ROLES.COMPANY_USER,
  ROLES.VIEWER
]);

// Rollen die een Company Admin zelf mag toekennen. Bewust zonder company_admin (die loopt
// via de uitnodigingsflow van de System Owner, inclusief MFA) en zonder system_owner.
const ASSIGNABLE_BY_COMPANY_ADMIN = Object.freeze([
  ROLES.PRODUCT_MANAGER,
  ROLES.COMPLIANCE_MANAGER,
  ROLES.COMPANY_USER,
  ROLES.VIEWER
]);

const PERMISSIONS = Object.freeze({
  // Platformbeheer (System Owner)
  PLATFORM_MANAGE: "platform:manage", // bedrijven, plannen, uitnodigingen, alle gebruikers
  PLATFORM_AUDIT: "platform:audit", // audit log van het hele platform

  // Company-omgeving
  COMPANY_DASHBOARD: "company:dashboard",
  COMPANY_SETTINGS: "company:settings",
  COMPANY_AUDIT: "company:audit",
  USERS_MANAGE: "users:manage",
  REPORTS_READ: "reports:read",

  PRODUCTS_READ: "products:read",
  PRODUCTS_CREATE: "products:create",
  PRODUCTS_UPDATE: "products:update", // algemene productvelden
  PRODUCTS_COMPLIANCE: "products:compliance", // materialen, herkomst, compliance, recycling, reparatie
  PRODUCTS_SUBMIT_REVIEW: "products:submit_review", // draft -> review
  PRODUCTS_PUBLISH: "products:publish", // -> published (en review -> draft terugsturen)
  PRODUCTS_ARCHIVE: "products:archive",

  DOCUMENTS_READ: "documents:read",
  DOCUMENTS_MANAGE: "documents:manage",

  QR_DOWNLOAD: "qr:download"
});

const P = PERMISSIONS;

const ROLE_PERMISSIONS = Object.freeze({
  // Supportmatig mag de System Owner producten/documenten van elke company lezen, maar
  // standaard niet wijzigen: daarom geen products:update/create/publish.
  [ROLES.SYSTEM_OWNER]: [P.PLATFORM_MANAGE, P.PLATFORM_AUDIT, P.PRODUCTS_READ, P.DOCUMENTS_READ],

  [ROLES.COMPANY_ADMIN]: [
    P.COMPANY_DASHBOARD,
    P.COMPANY_SETTINGS,
    P.COMPANY_AUDIT,
    P.USERS_MANAGE,
    P.REPORTS_READ,
    P.PRODUCTS_READ,
    P.PRODUCTS_CREATE,
    P.PRODUCTS_UPDATE,
    P.PRODUCTS_COMPLIANCE,
    P.PRODUCTS_SUBMIT_REVIEW,
    P.PRODUCTS_PUBLISH,
    P.PRODUCTS_ARCHIVE,
    P.DOCUMENTS_READ,
    P.DOCUMENTS_MANAGE,
    P.QR_DOWNLOAD
  ],

  [ROLES.PRODUCT_MANAGER]: [
    P.COMPANY_DASHBOARD,
    P.REPORTS_READ,
    P.PRODUCTS_READ,
    P.PRODUCTS_CREATE,
    P.PRODUCTS_UPDATE,
    P.PRODUCTS_COMPLIANCE,
    P.PRODUCTS_SUBMIT_REVIEW,
    P.PRODUCTS_PUBLISH,
    P.PRODUCTS_ARCHIVE,
    P.DOCUMENTS_READ,
    P.DOCUMENTS_MANAGE,
    P.QR_DOWNLOAD
  ],

  [ROLES.COMPLIANCE_MANAGER]: [
    P.COMPANY_DASHBOARD,
    P.REPORTS_READ,
    P.PRODUCTS_READ,
    P.PRODUCTS_COMPLIANCE,
    P.PRODUCTS_SUBMIT_REVIEW,
    P.DOCUMENTS_READ,
    P.DOCUMENTS_MANAGE
  ],

  // Algemene medewerker: productgegevens bijhouden, maar niet publiceren of archiveren.
  [ROLES.COMPANY_USER]: [
    P.COMPANY_DASHBOARD,
    P.PRODUCTS_READ,
    P.PRODUCTS_CREATE,
    P.PRODUCTS_UPDATE,
    P.PRODUCTS_SUBMIT_REVIEW,
    P.DOCUMENTS_READ,
    P.DOCUMENTS_MANAGE,
    P.QR_DOWNLOAD
  ],

  [ROLES.VIEWER]: [P.COMPANY_DASHBOARD, P.PRODUCTS_READ, P.DOCUMENTS_READ]
});

function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

function hasPermission(user, permission) {
  return Boolean(user && ROLE_PERMISSIONS[user.role] && ROLE_PERMISSIONS[user.role].includes(permission));
}

function isSystemOwner(user) {
  return Boolean(user && user.role === ROLES.SYSTEM_OWNER);
}

module.exports = {
  ROLES,
  ALL_ROLES,
  COMPANY_ROLES,
  ASSIGNABLE_BY_COMPANY_ADMIN,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  hasPermission,
  isSystemOwner
};
