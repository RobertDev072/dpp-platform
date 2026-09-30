// Menustructuur voor de AppShell. `icon` verwijst naar een inline SVG-icoon in
// AppShell (NAV_ICONS); `roles` beperkt zichtbaarheid tot die rollen.

export const ADMIN_MENU = [
  { label: "Overzicht", href: "/admin", icon: "home" },
  { label: "Bedrijven", href: "/admin/companies", icon: "building" },
  { label: "Partners", href: "/admin/partners", icon: "partners" },
  { label: "Gebruikers", href: "/admin/users", icon: "users" },
  { label: "Producten", href: "/admin/products", icon: "box" },
  { label: "Abonnementen", href: "/admin/licenses", icon: "credit-card" },
  { label: "Auditlog", href: "/admin/audit", icon: "scroll" }
];

// Partnergebied: uitsluitend klantbeheer en licentie-inzage — bewust géén
// product-, document- of gebruikersonderdelen.
export const PARTNER_MENU = [
  { label: "Overzicht", href: "/partner", icon: "home" },
  { label: "Nieuw klantbedrijf", href: "/partner/klanten/nieuw", icon: "building" },
  { label: "Profiel", href: "/partner/profiel", icon: "user" }
];

// Startpagina per rol: gebruikt na login, bij impersonatie-start en bij het
// stoppen daarvan, zodat elke rol altijd in het eigen gebied landt.
export function homeHrefForRole(role) {
  if (role === "platform_owner") {
    return "/admin";
  }
  if (role === "partner_admin") {
    return "/partner";
  }
  return "/company";
}

export const COMPANY_MENU = [
  { label: "Overzicht", href: "/company", icon: "home" },
  { label: "Producten", href: "/company/products", icon: "box" },
  { label: "Documenten", href: "/company/documenten", icon: "file" },
  { label: "QR-codes", href: "/company/qr-codes", icon: "qr" },
  { label: "Team", href: "/company/organisatie", icon: "team", roles: ["company_admin"] },
  { label: "Rapportages", href: "/company/rapportages", icon: "chart", roles: ["company_admin"] },
  { label: "Instellingen", href: "/company/instellingen", icon: "cog", roles: ["company_admin"] }
];
