// Platformbrede audit log (platform:audit). Filteren en bladeren gebeurt op de server
// (GET /api/audit?companyId=&action=&entityType=&limit=&offset= -> { items, total }).
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");
  const PAGE_SIZE = 50;

  content.appendChild(DPP.pageHeader({ title: "Audit log", subtitle: "Alle wijzigingen en aanmeldingen op het platform. Gevoelige waarden (wachtwoorden, tokens) worden nooit vastgelegd." }));

  const companyFilter = A.select("companyId", [{ value: "", label: "Alle bedrijven" }], { label: "Bedrijf" });
  const actionFilter = A.select(
    "action",
    A.options(
      Object.entries(A.AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label })),
      "Alle acties"
    ),
    { label: "Actie" }
  );
  const entityFilter = A.select(
    "entityType",
    A.options(
      Object.entries(A.ENTITY_LABELS).map(([value, label]) => ({ value, label })),
      "Alle typen"
    ),
    { label: "Type" }
  );
  const resetButton = el("button", { className: "btn btn-ghost btn-sm", text: "Filters wissen", attrs: { type: "button" } });
  const tableContainer = el("div");
  const pageInfo = el("span", { className: "muted" });
  const prevButton = el("button", { className: "btn btn-secondary btn-sm", text: "← Vorige", attrs: { type: "button" } });
  const nextButton = el("button", { className: "btn btn-secondary btn-sm", text: "Volgende →", attrs: { type: "button" } });

  content.appendChild(el("div", { className: "toolbar" }, companyFilter, actionFilter, entityFilter, resetButton));
  content.appendChild(tableContainer);
  content.appendChild(el("div", { className: "pagination" }, pageInfo, el("div", { className: "spacer" }), prevButton, nextButton));

  try {
    const companies = await A.loadCompanies();
    DPP.append(companyFilter, A.companyOptions(companies).map((o) => el("option", { text: o.label, attrs: { value: o.value } })));
  } catch (error) {
    DPP.showError(error);
  }

  let offset = 0;
  let total = 0;
  let requestSeq = 0;

  async function load() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (companyFilter.value) params.set("companyId", companyFilter.value);
    if (actionFilter.value) params.set("action", actionFilter.value);
    if (entityFilter.value) params.set("entityType", entityFilter.value);

    // Snel na elkaar filteren: alleen het antwoord op de laatste aanvraag tonen.
    const seq = ++requestSeq;
    prevButton.disabled = true;
    nextButton.disabled = true;
    let result;
    try {
      result = await api.get(`/api/audit?${params.toString()}`);
    } catch (error) {
      if (seq === requestSeq) DPP.showError(error);
      return;
    }
    if (seq !== requestSeq) return;

    total = result.total;
    const items = result.items;
    DPP.renderTable(tableContainer, {
      rows: items,
      empty: "Geen auditregels gevonden met deze filters",
      columns: [
        { label: "Tijdstip", className: "nowrap", render: (i) => DPP.formatDateTime(i.timestamp) },
        {
          label: "Actie",
          render: (i) => {
            const summary = A.metadataSummary(i.metadata, 90);
            // Op tablet staan de kolommen Doel en Details niet in beeld (anders past de tabel
            // niet en valt "Door" weg); dan doel en samenvatting onder de actie.
            return el(
              "div",
              { className: "cell-stack" },
              el("span", { className: "audit-action", text: A.actionLabel(i.action), attrs: { title: i.action } }),
              el("span", { className: "muted show-tablet", text: A.auditTarget(i) }),
              summary ? el("span", { className: "muted show-tablet", text: summary }) : null
            );
          }
        },
        { label: "Doel", className: "nowrap hide-tablet", render: (i) => A.auditTarget(i) },
        { label: "Bedrijf", render: (i) => i.company_name || el("span", { className: "muted", text: "Platform" }) },
        { label: "Door", className: "cell-truncate", render: (i) => i.actor_email || el("span", { className: "muted", text: "Systeem" }) },
        {
          label: "Details",
          className: "cell-meta hide-tablet",
          render: (i) => {
            const summary = A.metadataSummary(i.metadata);
            return summary ? el("span", { className: "muted", text: summary, attrs: { title: A.metadataSummary(i.metadata, 1000) } }) : "";
          }
        }
      ]
    });

    const from = total === 0 ? 0 : offset + 1;
    const to = Math.min(offset + items.length, total);
    pageInfo.textContent = `${DPP.formatNumber(from)}–${DPP.formatNumber(to)} van ${DPP.formatNumber(total)}`;
    prevButton.disabled = offset === 0;
    nextButton.disabled = offset + PAGE_SIZE >= total;
  }

  function applyFilters() {
    offset = 0;
    load();
  }

  for (const filter of [companyFilter, actionFilter, entityFilter]) filter.addEventListener("change", applyFilters);
  resetButton.addEventListener("click", () => {
    companyFilter.value = "";
    actionFilter.value = "";
    entityFilter.value = "";
    applyFilters();
  });
  prevButton.addEventListener("click", () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    load();
  });
  nextButton.addEventListener("click", () => {
    offset += PAGE_SIZE;
    load();
  });

  await load();
});
