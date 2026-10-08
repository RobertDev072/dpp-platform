// Menustructuur voor de AppShell. `icon` verwijst naar een inline SVG-icoon in
// AppShell (NAV_ICONS); `roles` beperkt zichtbaarheid tot die rollen.

export const ADMIN_MENU = [
  { label: "Overzicht", href: "/admin", icon: "home" },
  { label: "Partners", href: "/admin/partners", icon: "partners" },
  { label: "Klantbedrijven", href: "/admin/companies", icon: "building" },
  { label: "Alle gebruikers", href: "/admin/users", icon: "users" },
  { label: "Abonnementen", href: "/admin/licenses", icon: "credit-card" },
  { label: "Auditlog", href: "/admin/audit", icon: "scroll" },
  { label: "Systeemstatus", href: "/admin/systeemstatus", icon: "pulse" },
  { label: "Instellingen", href: "/admin/profiel", icon: "cog" }
];

// Partnergebied: uitsluitend klantbeheer en licentie-inzage — bewust géén
// product-, document- of gebruikersonderdelen.
export const PARTNER_MENU = [
  { label: "Overzicht", href: "/partner", icon: "home" },
  { label: "Mijn klanten", href: "/partner/klanten", icon: "building" },
  { label: "Uitnodigingen", href: "/partner/uitnodigingen", icon: "mail" },
  { label: "Licenties", href: "/partner/licenties", icon: "credit-card" },
  { label: "Activiteiten", href: "/partner/activiteiten", icon: "scroll" },
  { label: "Instellingen", href: "/partner/profiel", icon: "cog" },
  { label: "Help & support", href: "/partner/help", icon: "help" }
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

// Company-gebied is rolbewust: items met `roles` verschijnen alleen voor die
// rol. Bedrijfsbeheer (Medewerkers/Abonnement/Bedrijfsinstellingen) is exclusief
// voor de Bedrijfsbeheerder; een Medewerker ziet in plaats daarvan Mijn profiel.
export const COMPANY_MENU = [
  { label: "Overzicht", href: "/company", icon: "home" },
  { label: "Producten", href: "/company/products", icon: "box" },
  { label: "Documenten", href: "/company/documenten", icon: "file" },
  { label: "QR-codes", href: "/company/qr-codes", icon: "qr" },
  { label: "Import Center", href: "/company/imports", icon: "upload" },
  { label: "Print & labels", href: "/company/print-labels", icon: "printer" },
  { label: "Medewerkers", href: "/company/organisatie", icon: "team", roles: ["company_admin"] },
  { label: "Abonnement", href: "/company/abonnement", icon: "credit-card", roles: ["company_admin"] },
  { label: "Bedrijfsinstellingen", href: "/company/instellingen", icon: "cog", roles: ["company_admin"] },
  { label: "Mijn profiel", href: "/company/profiel", icon: "user", roles: ["company_user"] },
  { label: "Help & support", href: "/company/help", icon: "help" }
];
