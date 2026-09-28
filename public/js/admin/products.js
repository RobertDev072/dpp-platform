// Producten van alle bedrijven, alleen-lezen (supportweergave). De System Owner heeft
// products:read maar geen wijzigrechten; er staan hier dus bewust geen bewerkknoppen.
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");

  content.appendChild(
    DPP.pageHeader({
      title: "Producten",
      subtitle: "Supportweergave van de producten van alle bedrijven. Alleen lezen — wijzigingen doet het bedrijf zelf."
    })
  );

  const search = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op naam, SKU, GTIN of merk…", "aria-label": "Zoeken" } });
  const companyFilter = A.select("companyId", [{ value: "", label: "Alle bedrijven" }], { label: "Bedrijf" });
  const statusFilter = A.select("status", A.options(A.PRODUCT_STATUS_OPTIONS, "Alle statussen"), { label: "Status" });
  const count = el("span", { className: "toolbar-count muted" });
  const tableContainer = el("div");
  content.appendChild(el("div", { className: "toolbar" }, search, companyFilter, statusFilter, el("div", { className: "spacer" }), count));
  content.appendChild(tableContainer);

  let companies = [];
  let products = [];
  const companyNames = new Map();

  try {
    companies = await A.loadCompanies();
  } catch (error) {
    DPP.showError(error);
  }
  for (const c of companies) companyNames.set(c.id, c.name);
  DPP.append(companyFilter, A.companyOptions(companies).map((o) => el("option", { text: o.label, attrs: { value: o.value } })));

  // Alleen http(s)-links klikbaar maken: een javascript:-URL in de data mag nooit een link worden.
  function safeHref(value) {
    if (!value || typeof value !== "string") return null;
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function externalLink(value, label) {
    const href = safeHref(value);
    if (!href) return value ? el("span", { className: "mono", text: value }) : "—";
    return el("a", { text: label || value, attrs: { href, target: "_blank", rel: "noopener noreferrer" } });
  }

  function companyName(row) {
    return row.company_name || companyNames.get(row.company_id) || "—";
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const status = statusFilter.value;
    const rows = products.filter(
      (p) =>
        (!status || p.status === status) &&
        (!term || [p.name, p.sku, p.gtin, p.brand, p.manufacturer, p.model, p.category].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)))
    );
    count.textContent = `${rows.length} product${rows.length === 1 ? "" : "en"}`;
    DPP.renderTable(tableContainer, {
      rows,
      empty: products.length ? "Geen producten gevonden met deze filters" : "Nog geen producten",
      onRowClick: (row) => openDetail(row),
      columns: [
        {
          label: "Product",
          render: (p) => el("div", { className: "cell-stack" }, el("span", { className: "cell-strong", text: p.name }), p.sku ? el("span", { className: "muted mono", text: p.sku }) : null)
        },
        { label: "Bedrijf", render: (p) => companyName(p) },
        { label: "Categorie", render: (p) => p.category || "" },
        { label: "Status", render: (p) => DPP.statusBadge(p.status) },
        { label: "Bijgewerkt", className: "nowrap", render: (p) => DPP.formatDate(p.updated_at) },
        { label: "Publieke DPP", render: (p) => (p.status === "published" && safeHref(p.public_url) ? externalLink(p.public_url, "Openen ↗") : el("span", { className: "muted", text: "—" })) }
      ]
    });
  }

  async function load() {
    const params = new URLSearchParams();
    if (companyFilter.value) params.set("companyId", companyFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    const query = params.toString();
    try {
      products = await api.get(`/api/products${query ? `?${query}` : ""}`);
    } catch (error) {
      DPP.showError(error);
      products = [];
    }
    render();
  }

  const DETAIL_FIELDS = [
    ["sku", "SKU"],
    ["gtin", "GTIN"],
    ["brand", "Merk"],
    ["manufacturer", "Fabrikant"],
    ["model", "Model"],
    ["category", "Categorie"],
    ["country_of_origin", "Land van herkomst"],
    ["description", "Beschrijving"],
    ["materials", "Materialen"],
    ["compliance_info", "Compliance"],
    ["recycling_info", "Recycling"],
    ["repair_info", "Reparatie"],
    ["admin_notes", "Interne notities"]
  ];

  const DOCUMENT_TYPES = {
    manual: "Handleiding",
    certificate: "Certificaat",
    declaration: "Verklaring",
    safety: "Veiligheid",
    repair: "Reparatie",
    recycling: "Recycling",
    other: "Overig"
  };

  async function openDetail(row) {
    const detailBox = el("div", { className: "empty-state", text: "Laden…" });
    const documentsBox = el("div");
    DPP.openModal({
      title: row.name,
      wide: true,
      body: el(
        "div",
        { className: "product-detail" },
        el("p", { className: "alert alert-info" }, el("span", { text: "Alleen-lezen supportweergave. Wijzigingen doet het bedrijf zelf." })),
        detailBox,
        el("h3", { className: "section-title", text: "Documenten" }),
        documentsBox
      ),
      actions: [{ label: "Sluiten", className: "btn btn-secondary", onClick: (close) => close() }]
    });

    let product = row;
    try {
      product = await api.get(`/api/products/${encodeURIComponent(row.id)}`);
    } catch (error) {
      DPP.clear(detailBox);
      detailBox.className = "";
      detailBox.appendChild(el("div", { className: "alert alert-error" }, el("span", { text: error.message })));
      return;
    }

    const list = el("dl", { className: "detail-list" });
    const add = (label, value) => {
      list.appendChild(el("dt", { text: label }));
      list.appendChild(el("dd", null, value === null || value === undefined || value === "" ? "—" : value));
    };
    add("Bedrijf", companyName(product));
    add("Status", DPP.statusBadge(product.status));
    for (const [key, label] of DETAIL_FIELDS) {
      if (key in product) add(label, product[key]);
    }
    if (product.created_by_email) add("Aangemaakt door", product.created_by_email);
    add("Aangemaakt", DPP.formatDateTime(product.created_at));
    add("Bijgewerkt", DPP.formatDateTime(product.updated_at));
    add("Gepubliceerd", product.published_at ? DPP.formatDateTime(product.published_at) : "—");
    add("Publieke URL", product.status === "published" && product.public_url ? externalLink(product.public_url) : "—");
    DPP.clear(detailBox);
    detailBox.className = "";
    detailBox.appendChild(list);

    try {
      const documents = await api.get(`/api/products/${encodeURIComponent(row.id)}/documents`);
      DPP.renderTable(documentsBox, {
        rows: documents,
        empty: "Geen documenten",
        columns: [
          { label: "Titel", render: (d) => externalLink(d.url, d.title) },
          { label: "Type", render: (d) => DOCUMENT_TYPES[d.type] || d.type || "" },
          { label: "Taal", render: (d) => d.language || "" },
          { label: "Zichtbaarheid", render: (d) => A.yesNoBadge(d.is_public, { yes: "Publiek", no: "Intern" }) }
        ]
      });
    } catch {
      DPP.clear(documentsBox);
      documentsBox.appendChild(el("p", { className: "muted", text: "Documenten konden niet worden geladen." }));
    }
  }

  search.addEventListener("input", A.debounce(render, 120));
  companyFilter.addEventListener("change", load);
  statusFilter.addEventListener("change", load);

  await load();
});
