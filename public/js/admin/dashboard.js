// System Owner-dashboard: platformbrede cijfers uit GET /api/admin/stats.
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el, statCard, formatNumber } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");

  content.appendChild(
    DPP.pageHeader({
      title: "Dashboard",
      subtitle: "Overzicht van alle bedrijven, licenties en activiteit op het platform.",
      actions: [
        el("a", { className: "btn btn-secondary", text: "Company Admin uitnodigen", attrs: { href: "/admin/company-admins.html?tab=uitnodigingen" } }),
        el("a", { className: "btn", text: "Nieuw bedrijf", attrs: { href: "/admin/companies.html?nieuw=1" } })
      ]
    })
  );

  const statsGrid = el("div", { className: "stat-grid stat-grid-4" });
  const recentCompanies = el("div");
  const recentActivity = el("div");

  content.appendChild(statsGrid);
  content.appendChild(
    el(
      "div",
      { className: "dashboard-columns" },
      el(
        "section",
        { className: "card card-flush" },
        el("div", { className: "card-header" }, el("h2", { text: "Recente bedrijven" }), el("a", { className: "card-link", text: "Alle bedrijven", attrs: { href: "/admin/companies.html" } })),
        recentCompanies
      ),
      el(
        "section",
        { className: "card card-flush" },
        el("div", { className: "card-header" }, el("h2", { text: "Recente activiteit" }), el("a", { className: "card-link", text: "Volledige audit log", attrs: { href: "/admin/audit.html" } })),
        recentActivity
      )
    )
  );

  let stats;
  try {
    stats = await api.get("/api/admin/stats");
  } catch (error) {
    DPP.showError(error);
    return;
  }

  const { companies, users, licenses, products, dpps, scans, invitations } = stats;
  const seatRatio = licenses.totalSeats > 0 ? licenses.usedSeats / licenses.totalSeats : 0;

  const seatsCard = statCard({
    label: "Seats in gebruik",
    value: `${formatNumber(licenses.usedSeats)} / ${formatNumber(licenses.totalSeats)}`,
    hint: licenses.totalSeats > 0 ? `${Math.round(seatRatio * 100)}% van de gelicentieerde seats` : "Nog geen gelicentieerde seats",
    tone: seatRatio >= 0.9 ? "warning" : undefined
  });
  // Zonder gelicentieerde seats een lege, neutrale balk: seatsBar behandelt max 0 bewust als
  // "vol" (klopt voor één bedrijf met limiet 0), maar voor het platform betekent 0 "nog niets".
  seatsCard.appendChild(
    licenses.totalSeats > 0 ? A.seatsBar(licenses.usedSeats, licenses.totalSeats) : el("div", { className: "progress" }, el("div", { className: "progress-bar" }))
  );

  const invitesCard = el(
    "a",
    { className: "stat-card-link", attrs: { href: "/admin/company-admins.html?tab=uitnodigingen&status=pending" } },
    statCard({
      label: "Openstaande uitnodigingen",
      value: invitations.pending,
      hint: invitations.pending === 1 ? "1 Company Admin moet nog activeren" : `${formatNumber(invitations.pending)} Company Admins moeten nog activeren`,
      tone: invitations.pending > 0 ? "warning" : undefined
    })
  );

  DPP.append(statsGrid, [
    statCard({ label: "Bedrijven", value: companies.total, hint: `${formatNumber(companies.active)} actief · ${formatNumber(companies.total - companies.active)} niet actief` }),
    statCard({ label: "Gebruikers", value: users.total, hint: `${formatNumber(users.active)} actief (excl. System Owners)` }),
    statCard({ label: "Actieve licenties", value: licenses.activeLicenses, hint: "Actieve bedrijven met plan of eigen limiet" }),
    seatsCard,
    statCard({
      label: "Producten",
      value: products.total,
      hint: `${formatNumber(products.draft)} concept · ${formatNumber(products.review)} review · ${formatNumber(products.archived)} gearchiveerd`
    }),
    statCard({ label: "Gepubliceerde DPP's", value: dpps.published, hint: "Publiek bereikbaar via QR-code", tone: "success" }),
    statCard({ label: "QR-scans", value: scans.total, hint: `${formatNumber(scans.last30Days)} in de laatste 30 dagen` }),
    invitesCard
  ]);

  DPP.renderTable(recentCompanies, {
    rows: stats.recentCompanies,
    empty: "Nog geen bedrijven",
    onRowClick: (row) => {
      window.location.href = `/admin/company.html?id=${encodeURIComponent(row.id)}`;
    },
    columns: [
      { label: "Bedrijf", render: (row) => el("span", { className: "cell-strong", text: row.name }) },
      { label: "Status", render: (row) => DPP.statusBadge(row.status) },
      { label: "Aangemaakt", render: (row) => DPP.formatDate(row.created_at) }
    ]
  });

  DPP.renderTable(recentActivity, {
    rows: stats.recentActivity,
    empty: "Nog geen activiteit",
    columns: [
      { label: "Tijdstip", className: "nowrap", render: (row) => DPP.formatDateTime(row.timestamp) },
      // Doel en bedrijf onder de actie i.p.v. in eigen kolommen: de kaart is maar 3/5 van de
      // breedte, en met vijf kolommen viel "Door" op een laptop buiten beeld.
      {
        label: "Actie",
        render: (row) =>
          el(
            "div",
            { className: "cell-stack" },
            el("span", { text: A.actionLabel(row.action) }),
            el("span", { className: "muted", text: `${A.auditTarget(row)} · ${row.company_name || "Platform"}` })
          )
      },
      { label: "Door", className: "cell-truncate", render: (row) => row.actor_email || el("span", { className: "muted", text: "Systeem" }) }
    ]
  });
});
