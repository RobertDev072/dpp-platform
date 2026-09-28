// Bedrijvenoverzicht (System Owner): zoeken/filteren gebeurt in de browser op de volledige
// lijst uit GET /api/admin/companies; aanmaken via POST /api/admin/companies.
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");

  const newButton = el("button", { className: "btn", text: "Nieuw bedrijf", attrs: { type: "button" }, on: { click: () => openCreateModal() } });
  content.appendChild(DPP.pageHeader({ title: "Bedrijven", subtitle: "Alle klanten op het platform, met plan, seats en status.", actions: [newButton] }));

  const search = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op naam, KvK of contactpersoon…", "aria-label": "Zoeken" } });
  const statusFilter = A.select("status", A.options(A.COMPANY_STATUS_OPTIONS, "Alle statussen"), { label: "Status" });
  const planFilter = A.select("plan", [{ value: "", label: "Alle plannen" }], { label: "Plan" });
  const count = el("span", { className: "toolbar-count muted" });
  const tableContainer = el("div");

  content.appendChild(el("div", { className: "toolbar" }, search, statusFilter, planFilter, el("div", { className: "spacer" }), count));
  content.appendChild(tableContainer);

  let companies = [];
  let plans = [];

  function matches(company, term) {
    if (!term) return true;
    return [company.name, company.slug, company.kvk_number, company.contact_name, company.contact_email, company.country]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const status = statusFilter.value;
    const plan = planFilter.value;
    const rows = companies.filter(
      (c) =>
        matches(c, term) &&
        (!status || c.status === status) &&
        (!plan || (plan === "none" ? c.plan_id == null : String(c.plan_id) === plan))
    );
    count.textContent = rows.length === companies.length ? `${rows.length} bedrijven` : `${rows.length} van ${companies.length} bedrijven`;

    DPP.renderTable(tableContainer, {
      rows,
      empty: companies.length ? "Geen bedrijven gevonden met deze filters" : "Nog geen bedrijven. Maak het eerste bedrijf aan.",
      onRowClick: (row) => {
        window.location.href = `/admin/company.html?id=${encodeURIComponent(row.id)}`;
      },
      columns: [
        {
          label: "Naam",
          render: (c) =>
            el(
              "div",
              { className: "cell-stack" },
              el("span", { className: "cell-strong", text: c.name }),
              c.contact_name ? el("span", { className: "muted", text: c.contact_name }) : null
            )
        },
        { label: "KvK", className: "hide-tablet", render: (c) => c.kvk_number || "" },
        { label: "Land", className: "hide-tablet", render: (c) => c.country || "" },
        { label: "Plan", className: "nowrap", render: (c) => c.plan_name || el("span", { className: "muted", text: "Geen plan" }) },
        { label: "Seats", render: (c) => A.seatsCell(c.active_users, c.effective_max_users) },
        { label: "Status", render: (c) => DPP.statusBadge(c.status) },
        { label: "Aangemaakt", className: "nowrap", render: (c) => DPP.formatDate(c.created_at) }
      ]
    });
  }

  async function load() {
    try {
      [companies, plans] = await Promise.all([A.loadCompanies({ refresh: true }), A.loadPlans()]);
    } catch (error) {
      DPP.showError(error);
      return;
    }
    const current = planFilter.value;
    DPP.clear(planFilter);
    DPP.append(planFilter, [
      el("option", { text: "Alle plannen", attrs: { value: "" } }),
      plans.map((p) => el("option", { text: p.name, attrs: { value: p.id } })),
      el("option", { text: "Geen plan", attrs: { value: "none" } })
    ]);
    planFilter.value = current;
    render();
  }

  function openCreateModal() {
    A.formModal({
      title: "Nieuw bedrijf",
      submitLabel: "Bedrijf aanmaken",
      wide: true,
      fields: [
        { name: "name", label: "Bedrijfsnaam", required: true, full: true, maxlength: 200 },
        { name: "kvkNumber", label: "KvK-nummer", maxlength: 20 },
        { name: "country", label: "Land", maxlength: 100, value: "Nederland" },
        { name: "address", label: "Adres", type: "textarea", rows: 2, full: true, maxlength: 500 },
        { name: "contactName", label: "Contactpersoon", maxlength: 200 },
        { name: "contactEmail", label: "E-mailadres contactpersoon", type: "email", maxlength: 256 },
        { name: "planId", label: "Plan", type: "select", options: A.planOptions(plans) },
        {
          name: "maxUsers",
          label: "Max. gebruikers",
          type: "number",
          min: 0,
          max: 1000000,
          help: "Leeg laten = limiet van het plan volgen. Zonder plan en limiet: onbeperkt."
        }
        // Geen statusveld (docs §9): een nieuw bedrijf is altijd actief; status wijzigt alleen
        // via de knoppen op de detailpagina, elk met bevestiging.
      ],
      onSubmit: async (data, form, close) => {
        const created = await api.post("/api/admin/companies", {
          name: data.name,
          kvkNumber: data.kvkNumber,
          country: data.country,
          address: data.address,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          planId: A.numberOrNull(data.planId),
          maxUsers: A.numberOrNull(data.maxUsers)
        });
        close();
        // Direct door naar de detailpagina: daar staat de volgende stap (admin uitnodigen).
        window.location.href = `/admin/company.html?id=${encodeURIComponent(created.id)}&nieuw=1`;
      }
    });
  }

  search.addEventListener("input", A.debounce(render, 120));
  statusFilter.addEventListener("change", render);
  planFilter.addEventListener("change", render);

  await load();

  if (DPP.getQueryParam("nieuw") === "1") {
    window.history.replaceState(null, "", window.location.pathname);
    openCreateModal();
  }
});
