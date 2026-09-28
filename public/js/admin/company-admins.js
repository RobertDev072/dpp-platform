// Company Admins over alle bedrijven heen + alle uitnodigingen. Nieuwe Company Admins
// lopen altijd via een uitnodiging (activatielink + MFA), nooit via "gebruiker aanmaken".
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");

  const inviteButton = el("button", {
    className: "btn",
    text: "Company Admin uitnodigen",
    attrs: { type: "button" },
    on: { click: () => A.openInviteModal({ onDone: () => loadInvitations() }) }
  });
  content.appendChild(
    DPP.pageHeader({
      title: "Company Admins",
      subtitle: "Beheerders van alle bedrijven en de uitnodigingen die nog openstaan.",
      actions: [inviteButton]
    })
  );

  const tabAdmins = el("button", { className: "tab", attrs: { type: "button", role: "tab" } });
  const tabInvites = el("button", { className: "tab", attrs: { type: "button", role: "tab" } });
  content.appendChild(el("div", { className: "tabs", attrs: { role: "tablist" } }, tabAdmins, tabInvites));

  // --- Beheerders ---
  const adminSearch = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op naam, e-mail of bedrijf…", "aria-label": "Zoeken" } });
  const adminStatus = A.select("status", A.options(A.USER_STATUS_OPTIONS, "Alle statussen"), { label: "Status" });
  const adminCount = el("span", { className: "toolbar-count muted" });
  const adminTable = el("div");
  const adminsPanel = el("section", { attrs: { role: "tabpanel" } }, el("div", { className: "toolbar" }, adminSearch, adminStatus, el("div", { className: "spacer" }), adminCount), adminTable);

  // --- Uitnodigingen ---
  const inviteSearch = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op e-mail of bedrijf…", "aria-label": "Zoeken" } });
  const initialStatus = DPP.getQueryParam("status");
  const inviteStatus = A.select("status", A.options(A.INVITE_STATUS_OPTIONS, "Alle statussen"), {
    label: "Status",
    value: A.INVITE_STATUS_OPTIONS.some((o) => o.value === initialStatus) ? initialStatus : ""
  });
  const inviteCount = el("span", { className: "toolbar-count muted" });
  const inviteTable = el("div");
  const invitesPanel = el("section", { attrs: { role: "tabpanel" } }, el("div", { className: "toolbar" }, inviteSearch, inviteStatus, el("div", { className: "spacer" }), inviteCount), inviteTable);

  content.appendChild(adminsPanel);
  content.appendChild(invitesPanel);

  let admins = [];
  let invitations = [];
  let pendingCount = 0;

  function selectTab(name) {
    const invites = name === "uitnodigingen";
    tabAdmins.classList.toggle("active", !invites);
    tabInvites.classList.toggle("active", invites);
    tabAdmins.setAttribute("aria-selected", String(!invites));
    tabInvites.setAttribute("aria-selected", String(invites));
    adminsPanel.classList.toggle("hidden", invites);
    invitesPanel.classList.toggle("hidden", !invites);
    const url = new URL(window.location.href);
    url.search = invites ? "?tab=uitnodigingen" : "";
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  function updateTabLabels() {
    tabAdmins.textContent = `Beheerders (${admins.length})`;
    tabInvites.textContent = pendingCount > 0 ? `Uitnodigingen (${pendingCount} openstaand)` : "Uitnodigingen";
  }

  tabAdmins.addEventListener("click", () => {
    selectTab("beheerders");
    // Een uitnodiging kan intussen geaccepteerd zijn: dan staat er een nieuwe beheerder.
    loadAdmins();
  });
  tabInvites.addEventListener("click", () => selectTab("uitnodigingen"));

  function renderAdmins() {
    const term = adminSearch.value.trim().toLowerCase();
    const rows = admins.filter(
      (a) =>
        (!adminStatus.value || a.status === adminStatus.value) &&
        (!term || [a.email, a.first_name, a.last_name, a.company_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)))
    );
    adminCount.textContent = `${rows.length} beheerder${rows.length === 1 ? "" : "s"}`;
    DPP.renderTable(adminTable, {
      rows,
      empty: admins.length ? "Geen beheerders gevonden met deze filters" : "Nog geen Company Admins. Nodig de eerste uit.",
      onRowClick: (row) => {
        window.location.href = `/admin/company.html?id=${encodeURIComponent(row.company_id)}`;
      },
      columns: [
        { label: "Naam", render: (a) => A.personCell(a) },
        { label: "Bedrijf", render: (a) => a.company_name || "" },
        { label: "Status", render: (a) => DPP.statusBadge(a.status) },
        { label: "Identiteit", className: "hide-tablet", render: (a) => (a.identity === "entra" ? "Entra ID" : "Lokaal") },
        { label: "Laatste login", className: "nowrap", render: (a) => (a.last_login_at ? DPP.formatDateTime(a.last_login_at) : el("span", { className: "muted", text: "Nog niet ingelogd" })) }
      ]
    });
  }

  function renderInvites() {
    const term = inviteSearch.value.trim().toLowerCase();
    const rows = invitations.filter(
      (i) => !term || [i.email, i.first_name, i.last_name, i.company_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    );
    inviteCount.textContent = `${rows.length} uitnodiging${rows.length === 1 ? "" : "en"}`;
    A.renderInvitations(inviteTable, rows, {
      showCompany: true,
      onChange: () => loadInvitations(),
      empty: inviteStatus.value ? "Geen uitnodigingen met deze status" : "Nog geen uitnodigingen verstuurd"
    });
  }

  async function loadAdmins() {
    try {
      admins = await api.get("/api/users?role=company_admin");
    } catch (error) {
      DPP.showError(error);
      admins = [];
    }
    updateTabLabels();
    renderAdmins();
  }

  async function loadInvitations() {
    try {
      const status = inviteStatus.value;
      const [list, pending] = await Promise.all([
        api.get(`/api/admin/invitations${status ? `?status=${encodeURIComponent(status)}` : ""}`),
        status === "pending" ? null : api.get("/api/admin/invitations?status=pending")
      ]);
      invitations = list;
      pendingCount = (pending || list).length;
    } catch (error) {
      DPP.showError(error);
      invitations = [];
    }
    updateTabLabels();
    renderInvites();
  }

  adminSearch.addEventListener("input", A.debounce(renderAdmins, 120));
  adminStatus.addEventListener("change", renderAdmins);
  inviteSearch.addEventListener("input", A.debounce(renderInvites, 120));
  inviteStatus.addEventListener("change", loadInvitations);

  selectTab(DPP.getQueryParam("tab") === "uitnodigingen" ? "uitnodigingen" : "beheerders");
  updateTabLabels();
  await Promise.all([loadAdmins(), loadInvitations()]);
});
