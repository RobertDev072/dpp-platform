// Nederlandse labels voor rollen en gebruikersstatussen — één plek, zodat
// organisatie- en adminpagina's dezelfde teksten tonen.

export const ROLE_LABELS = {
  platform_owner: "Platform Owner",
  company_admin: "Company Admin",
  company_user: "Productmedewerker"
};

export const ASSIGNABLE_ROLE_OPTIONS = [
  { value: "company_admin", label: "Company Admin" },
  { value: "company_user", label: "Productmedewerker" }
];

export const USER_STATUS_LABELS = {
  active: "Actief",
  blocked: "Geblokkeerd",
  suspended: "Opgeschort",
  archived: "Gearchiveerd"
};

export const USER_STATUS_OPTIONS = [
  { value: "active", label: "Actief" },
  { value: "blocked", label: "Geblokkeerd" },
  { value: "suspended", label: "Opgeschort" },
  { value: "archived", label: "Gearchiveerd" }
];

export const USER_STATUS_BADGE_VARIANTS = {
  active: "success",
  blocked: "danger",
  suspended: "warning",
  archived: "neutral"
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

export function statusLabel(status) {
  return USER_STATUS_LABELS[status] || status;
}

export function fullName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}
