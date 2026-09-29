// Menustructuur voor de AppShell. `icon` verwijst naar een inline SVG-icoon in
// AppShell (NAV_ICONS); `roles` beperkt zichtbaarheid tot die rollen.

export const ADMIN_MENU = [
  { label: "Overzicht", href: "/admin", icon: "home" },
  { label: "Bedrijven", href: "/admin/companies", icon: "building" },
  { label: "Gebruikers", href: "/admin/users", icon: "users" },
  { label: "Producten", href: "/admin/products", icon: "box" },
  { label: "Abonnementen", href: "/admin/licenses", icon: "credit-card" },
  { label: "Auditlog", href: "/admin/audit", icon: "scroll" }
];

export const COMPANY_MENU = [
  { label: "Overzicht", href: "/company", icon: "home" },
  { label: "Producten", href: "/company/products", icon: "box" },
  { label: "Documenten", href: "/company/documenten", icon: "file" },
  { label: "QR-codes", href: "/company/qr-codes", icon: "qr" },
  { label: "Team", href: "/company/organisatie", icon: "team", roles: ["company_admin"] },
  { label: "Rapportages", href: "/company/rapportages", icon: "chart", roles: ["company_admin"] },
  { label: "Instellingen", href: "/company/instellingen", icon: "cog", roles: ["company_admin"] }
];
