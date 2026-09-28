// App-shell: sidebar + topbar per omgeving, gefilterd op de permissies van de gebruiker.
// Verbergen in de UI is alleen gemak — de backend dwingt elke permissie zelf af.
//
// Gebruik op een pagina:
//   <body class="app-shell" data-area="admin|app" data-page="<menu-key>">
//     <aside id="sidebar" class="sidebar"></aside>
//     <div class="main-col">
//       <header id="topbar" class="topbar"></header>
//       <main id="content" class="content"> ... </main>
//     </div>
//     <script src="/js/api.js"></script><script src="/js/dom.js"></script>
//     <script src="/js/layout.js"></script><script src="/js/<pagina>.js"></script>
//   en in het paginascript:  DPP.initPage().then((user) => { ... })
(function () {
  const DPP = (window.DPP = window.DPP || {});
  const { el, clear } = DPP;

  const MENUS = {
    // System Owner: platformbeheer
    admin: [
      { key: "dashboard", label: "Dashboard", href: "/admin/index.html", icon: "▦", permission: "platform:manage" },
      { key: "companies", label: "Bedrijven", href: "/admin/companies.html", icon: "▣", permission: "platform:manage" },
      { key: "company-admins", label: "Company Admins", href: "/admin/company-admins.html", icon: "✉", permission: "platform:manage" },
      { key: "users", label: "Gebruikers", href: "/admin/users.html", icon: "◉", permission: "platform:manage" },
      { key: "plans", label: "Licenties", href: "/admin/plans.html", icon: "◈", permission: "platform:manage" },
      { key: "products", label: "Producten", href: "/admin/products.html", icon: "▤", permission: "products:read" },
      { key: "audit", label: "Audit", href: "/admin/audit.html", icon: "☰", permission: "platform:audit" },
      { key: "settings", label: "Instellingen", href: "/admin/settings.html", icon: "⚙", permission: "platform:manage" }
    ],
    // Company Admin + medewerkers: eigen company
    app: [
      { key: "dashboard", label: "Dashboard", href: "/app/index.html", icon: "▦", permission: "company:dashboard" },
      { key: "products", label: "Producten", href: "/app/products.html", icon: "▤", permission: "products:read" },
      { key: "users", label: "Gebruikers", href: "/app/users.html", icon: "◉", permission: "users:manage" },
      { key: "documents", label: "Documenten", href: "/app/documents.html", icon: "▧", permission: "documents:read" },
      { key: "qr", label: "QR-codes", href: "/app/qr.html", icon: "▩", permission: "qr:download" },
      { key: "reports", label: "Rapportages", href: "/app/reports.html", icon: "◔", permission: "reports:read" },
      { key: "settings", label: "Instellingen", href: "/app/settings.html", icon: "⚙", permission: "company:settings" }
    ]
  };

  let currentUser = null;

  function can(permission) {
    return Boolean(currentUser && currentUser.permissions && currentUser.permissions.includes(permission));
  }

  function homeFor(user) {
    return user.role === "system_owner" ? "/admin/index.html" : "/app/index.html";
  }

  function renderSidebar(area, activeKey, user) {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    clear(sidebar);

    const items = MENUS[area].filter((item) => can(item.permission));
    sidebar.appendChild(
      el(
        "div",
        { className: "sidebar-brand" },
        el("span", { className: "brand-mark", text: "DPP" }),
        el("span", { className: "brand-text", text: area === "admin" ? "Platformbeheer" : user.companyName || "DPP Platform" })
      )
    );
    sidebar.appendChild(
      el(
        "nav",
        { className: "sidebar-nav", attrs: { "aria-label": "Hoofdmenu" } },
        items.map((item) =>
          el(
            "a",
            {
              className: `nav-item${item.key === activeKey ? " active" : ""}`,
              attrs: { href: item.href, "aria-current": item.key === activeKey ? "page" : undefined }
            },
            el("span", { className: "nav-icon", text: item.icon, attrs: { "aria-hidden": "true" } }),
            el("span", { text: item.label })
          )
        )
      )
    );
    sidebar.appendChild(el("div", { className: "sidebar-footer", text: "DPP Platform" }));
  }

  function renderTopbar(user) {
    const topbar = document.getElementById("topbar");
    if (!topbar) return;
    clear(topbar);

    const toggle = el("button", {
      className: "sidebar-toggle",
      text: "☰",
      attrs: { type: "button", "aria-label": "Menu tonen/verbergen" },
      on: { click: () => document.body.classList.toggle("sidebar-open") }
    });

    const logoutBtn = el("button", {
      className: "btn btn-ghost",
      text: "Uitloggen",
      attrs: { type: "button" },
      on: {
        click: async () => {
          try {
            await api.post("/api/auth/logout");
          } finally {
            window.location.href = "/login.html";
          }
        }
      }
    });

    topbar.appendChild(toggle);
    topbar.appendChild(el("div", { className: "topbar-spacer" }));
    topbar.appendChild(
      el(
        "div",
        { className: "topbar-user" },
        el(
          "div",
          { className: "user-meta" },
          el("div", { className: "user-name", text: DPP.fullName(user) }),
          el("div", { className: "user-role", text: DPP.roleLabel(user.role) + (user.companyName ? ` · ${user.companyName}` : "") })
        ),
        logoutBtn
      )
    );
  }

  function renderNoAccess() {
    const content = document.getElementById("content");
    if (!content) return;
    clear(content);
    content.appendChild(
      el(
        "div",
        { className: "card empty-state" },
        el("h2", { text: "Geen toegang" }),
        el("p", { text: "Je hebt geen rechten voor deze pagina." }),
        el("a", { className: "btn", text: "Naar dashboard", attrs: { href: homeFor(currentUser) } })
      )
    );
  }

  // Resolvet met de ingelogde gebruiker, of met null als de gebruiker wordt doorgestuurd /
  // geen toegang heeft (het paginascript moet dan niets meer doen).
  async function initPage() {
    const area = document.body.dataset.area;
    const pageKey = document.body.dataset.page;

    currentUser = await api.get("/api/auth/me");
    DPP.currentUser = currentUser;

    // Verkeerde omgeving: System Owner hoort in /admin, alle anderen in /app.
    const expectedArea = currentUser.role === "system_owner" ? "admin" : "app";
    if (area !== expectedArea) {
      window.location.replace(homeFor(currentUser));
      return null;
    }

    // Het dashboard van /app is voor elke company-rol het startpunt; als een rol geen
    // dashboard-permissie zou hebben, sturen we naar het eerste toegestane menu-item.
    renderSidebar(area, pageKey, currentUser);
    renderTopbar(currentUser);

    const menuItem = MENUS[area].find((item) => item.key === pageKey);
    if (menuItem && !can(menuItem.permission)) {
      const firstAllowed = MENUS[area].find((item) => can(item.permission));
      if (pageKey === "dashboard" && firstAllowed) {
        window.location.replace(firstAllowed.href);
        return null;
      }
      renderNoAccess();
      return null;
    }

    document.body.classList.add("ready");
    return currentUser;
  }

  Object.assign(DPP, { MENUS, initPage, can, homeFor });
})();
