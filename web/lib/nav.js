export const ADMIN_MENU = [
  { label: "Dashboard", href: "/admin" },
  { label: "Bedrijven", href: "/admin/companies" },
  { label: "Gebruikers", href: "/admin/users" },
  { label: "Licenties", href: "/admin/licenses" },
  { label: "Audit Log", href: "/admin/audit" }
];

export const COMPANY_MENU = [
  { label: "Dashboard", href: "/company" },
  { label: "Producten", href: "/company/products" },
  { label: "Organisatie", href: "/company/organisatie", roles: ["company_admin"] },
  { label: "Rapportages", href: "/company/rapportages", roles: ["company_admin"] }
];
