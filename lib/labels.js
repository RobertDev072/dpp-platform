// Nederlandse labels voor rollen en gebruikersstatussen — één plek, zodat
// organisatie- en adminpagina's dezelfde teksten tonen.

export const ROLE_LABELS = {
  platform_owner: "Platform Owner",
  partner_admin: "Partner Admin",
  company_admin: "Bedrijfsbeheerder",
  company_user: "Medewerker"
};

export const ASSIGNABLE_ROLE_OPTIONS = [
  { value: "company_admin", label: "Bedrijfsbeheerder" },
  { value: "company_user", label: "Medewerker" }
];

// Partner Admins horen exclusief bij partnerbedrijven (en omgekeerd): de
// gebruikerspagina van de owner kiest op basis van de bedrijfssoort welke set geldt.
export const PARTNER_ROLE_OPTIONS = [{ value: "partner_admin", label: "Partner Admin" }];

export const USER_STATUS_LABELS = {
  active: "Actief",
  blocked: "Geblokkeerd",
  suspended: "Opgeschort",
  archived: "Gearchiveerd",
  deleted: "Verwijderd"
};

// "deleted" staat hier bewust niet bij: dat is geen omkeerbare statuswijziging zoals de
// rest (het verwijdert ook definitief het Supabase Auth-account), dus dat heeft een eigen
// bevestigde "Verwijderen"-actie nodig, niet een losse optie in deze dropdown.
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
  archived: "neutral",
  deleted: "danger"
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
