// Company-dashboard: kerncijfers, snelle acties en (alleen voor company:audit) recente
// wijzigingen. De backend geeft recentActivity al leeg terug zonder audit-permissie; de
// check hier is alleen om geen lege kaart te tonen.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  function statLink(href, card) {
    return href ? el("a", { className: "stat-card-link", attrs: { href } }, card) : card;
  }

  function licenseCard(seats) {
    const max = seats.maxUsers;
    const active = seats.activeUsers || 0;
    const card = DPP.statCard({
      label: "Licenties in gebruik",
      value: max == null ? `${DPP.formatNumber(active)}` : `${DPP.formatNumber(active)} / ${DPP.formatNumber(max)}`,
      hint:
        max == null
          ? "Onbeperkt aantal gebruikers"
          : seats.remainingSeats > 0
            ? `${DPP.formatNumber(seats.remainingSeats)} beschikbaar`
            : "Geen licenties meer beschikbaar",
      tone: max != null && seats.remainingSeats <= 0 ? "danger" : undefined
    });
    card.appendChild(A.seatsBar(active, max));
    return card;
  }

  function renderStats(data) {
    const products = data.products || {};
    const users = data.users || {};
    const scans = data.scans || {};
    const canUsers = DPP.can("users:manage");
    const canReports = DPP.can("reports:read");

    const productCards = el(
      "div",
      { className: "stat-grid stat-grid-4" },
      statLink("/app/products.html", DPP.statCard({ label: "Producten", value: products.total || 0, hint: `${DPP.formatNumber(products.archived || 0)} gearchiveerd` })),
      statLink(
        "/app/products.html?status=published",
        DPP.statCard({ label: "Gepubliceerde DPP's", value: products.published || 0, hint: "Publiek zichtbaar via QR-code", tone: "success" })
      ),
      statLink("/app/products.html?status=draft", DPP.statCard({ label: "Concepten", value: products.draft || 0, hint: "Nog in bewerking" })),
      statLink(
        "/app/products.html?status=review",
        DPP.statCard({
          label: "In review",
          value: products.review || 0,
          hint: products.review ? "Wacht op publicatie" : "Niets te beoordelen",
          tone: products.review ? "warning" : undefined
        })
      )
    );

    const inactive = (users.inactive || 0) + (users.blocked || 0);
    const teamCards = el(
      "div",
      { className: "stat-grid stat-grid-4" },
      statLink(
        canUsers ? "/app/users.html" : null,
        DPP.statCard({ label: "Gebruikers", value: users.total || 0, hint: `${DPP.formatNumber(users.active || 0)} actief${inactive ? ` · ${DPP.formatNumber(inactive)} inactief/geblokkeerd` : ""}` })
      ),
      statLink(canUsers ? "/app/users.html" : null, licenseCard(data.seats || {})),
      statLink(canReports ? "/app/reports.html" : null, DPP.statCard({ label: "QR-scans totaal", value: scans.total || 0, hint: "Sinds de eerste publicatie" })),
      statLink(canReports ? "/app/reports.html" : null, DPP.statCard({ label: "QR-scans laatste 30 dagen", value: scans.last30Days || 0, hint: "Via de QR-code op het product" }))
    );

    return el(
      "div",
      null,
      el("div", { className: "stat-group-title", text: "Producten en paspoorten" }),
      productCards,
      el("div", { className: "stat-group-title", text: "Team en bereik" }),
      teamCards
    );
  }

  function quickAction({ icon, title, text, href, onClick }) {
    const children = [
      el("span", { className: "quick-action-icon", text: icon, attrs: { "aria-hidden": "true" } }),
      el("span", { className: "quick-action-text" }, el("strong", { text: title }), el("span", { text }))
    ];
    if (href) return el("a", { className: "quick-action", attrs: { href } }, children);
    return el("button", { className: "quick-action", attrs: { type: "button" }, on: { click: onClick } }, children);
  }

  function renderQuickActions(categories) {
    const actions = [
      DPP.can("products:create")
        ? quickAction({ icon: "+", title: "Nieuw product", text: "Start een nieuw productpaspoort als concept", onClick: () => A.openProductCreateModal({ categories }) })
        : null,
      DPP.can("users:manage")
        ? quickAction({ icon: "◉", title: "Medewerker toevoegen", text: "Account aanmaken met een tijdelijk wachtwoord", href: "/app/users.html?nieuw=1" })
        : null,
      quickAction({ icon: "▤", title: "Producten bekijken", text: "Zoek, filter en open productpaspoorten", href: "/app/products.html" }),
      DPP.can("qr:download") ? quickAction({ icon: "▩", title: "QR-codes downloaden", text: "Voor product, verpakking of label", href: "/app/qr.html" }) : null,
      DPP.can("reports:read") ? quickAction({ icon: "◔", title: "Rapportages", text: "Scans, voortgang en onvolledige producten", href: "/app/reports.html" }) : null,
      DPP.can("company:settings") ? quickAction({ icon: "⚙", title: "Bedrijfsgegevens", text: "Adres en contactpersoon bijwerken", href: "/app/settings.html" }) : null
    ];
    return el(
      "div",
      { className: "card" },
      el("div", { className: "card-header" }, el("h2", { text: "Snelle acties" })),
      el("div", { className: "quick-actions" }, actions)
    );
  }

  function renderRecentProducts(products) {
    const recent = [...products]
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .slice(0, 6);
    const tableHolder = el("div");
    DPP.renderTable(tableHolder, {
      columns: [
        {
          label: "Product",
          render: (p) => el("div", { className: "cell-stack" }, el("span", { className: "cell-strong", text: p.name }), el("span", { className: "muted", text: p.sku || "Geen SKU" }))
        },
        { label: "Status", render: (p) => DPP.statusBadge(p.status) },
        { label: "Bijgewerkt", className: "nowrap", render: (p) => DPP.formatDate(p.updated_at || p.created_at) }
      ],
      rows: recent,
      empty: "Nog geen producten.",
      onRowClick: (p) => {
        window.location.href = A.productHref(p.id);
      }
    });
    return el(
      "div",
      { className: "card card-flush" },
      el("div", { className: "card-header" }, el("h2", { text: "Recent bijgewerkte producten" }), el("a", { className: "card-link", text: "Alle producten →", attrs: { href: "/app/products.html" } })),
      tableHolder
    );
  }

  function renderActivity(items) {
    const holder = el("div");
    DPP.renderTable(holder, {
      columns: [
        { label: "Tijdstip", className: "nowrap", render: (item) => DPP.formatDateTime(item.timestamp) },
        { label: "Actie", render: (item) => el("span", { className: "cell-strong", text: A.actionLabel(item.action) }) },
        { label: "Onderdeel", className: "nowrap", render: (item) => `${A.entityLabel(item.entity_type)}${item.entity_id != null ? ` #${item.entity_id}` : ""}` },
        { label: "Details", className: "hide-tablet", render: (item) => A.describeAudit(item) },
        { label: "Door", render: (item) => A.actorLabel(item) }
      ],
      rows: items
    });
    return el(
      "div",
      { className: "card card-flush" },
      el("div", { className: "card-header" }, el("h2", { text: "Recente wijzigingen" }), el("span", { className: "card-subtitle", text: "Laatste 10 acties in je bedrijf" })),
      holder
    );
  }

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");

    const headerActions = [
      DPP.can("users:manage") ? el("a", { className: "btn btn-secondary", text: "Medewerker toevoegen", attrs: { href: "/app/users.html?nieuw=1" } }) : null,
      DPP.can("products:create") ? el("button", { className: "btn", text: "Nieuw product", attrs: { type: "button" } }) : null
    ].filter(Boolean);

    const greeting = user.firstName ? `Welkom terug, ${user.firstName}.` : "Welkom terug.";
    content.appendChild(DPP.pageHeader({ title: "Dashboard", subtitle: `${greeting} Overzicht van ${user.companyName || "je bedrijf"}.`, actions: headerActions }));
    const body = el("div", null, A.loadingState());
    content.appendChild(body);

    try {
      const [data, products] = await Promise.all([api.get("/api/company/dashboard"), api.get("/api/products")]);
      const categories = A.uniqueCategories(products);

      const newButton = headerActions.find((node) => node.tagName === "BUTTON");
      if (newButton) newButton.addEventListener("click", () => A.openProductCreateModal({ categories }));

      DPP.clear(body);
      body.appendChild(renderStats(data));
      body.appendChild(el("div", { className: "dash-columns" }, renderRecentProducts(products), renderQuickActions(categories)));

      const activity = Array.isArray(data.recentActivity) ? data.recentActivity : [];
      if (DPP.can("company:audit") && activity.length > 0) {
        body.appendChild(renderActivity(activity));
      }
    } catch (error) {
      DPP.clear(body);
      body.appendChild(A.errorCard("Dashboard kon niet worden geladen", A.errorMessage(error)));
    }
  });
})();
