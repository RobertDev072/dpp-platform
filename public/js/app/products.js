// Productoverzicht van de eigen company. Filters gaan als query naar de API (tenant-scope
// komt daar uit de sessie); de filterstand staat in de URL zodat terugnavigeren en
// dashboardlinks (?status=review) werken. Alleen filterwaarden in de URL, geen gegevens.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  const STATUS_VALUES = A.PRODUCT_STATUS_OPTIONS.map((o) => o.value);

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");
    const params = new URLSearchParams(window.location.search);

    const initialStatus = STATUS_VALUES.includes(params.get("status")) ? params.get("status") : "";
    const initialQuery = (params.get("q") || "").slice(0, 200);
    const initialCategory = (params.get("category") || "").slice(0, 100);

    let categories = [];

    const newButton = DPP.can("products:create")
      ? el("button", { className: "btn", text: "Nieuw product", attrs: { type: "button" }, on: { click: () => A.openProductCreateModal({ categories }) } })
      : null;

    content.appendChild(
      DPP.pageHeader({
        title: "Producten",
        subtitle: "Alle productpaspoorten van je bedrijf, van concept tot gepubliceerd.",
        actions: newButton ? [newButton] : []
      })
    );

    const search = el("input", {
      className: "input toolbar-search",
      attrs: { type: "search", placeholder: "Zoek op naam of SKU…", "aria-label": "Zoeken", maxlength: 200, value: initialQuery }
    });
    const statusSelect = A.select("status", [{ value: "", label: "Alle statussen" }, ...A.PRODUCT_STATUS_OPTIONS], { label: "Status", value: initialStatus });
    const categorySelect = A.select("category", [{ value: "", label: "Alle categorieën" }], { label: "Categorie" });
    const count = el("span", { className: "toolbar-count muted" });
    const resetButton = el("button", { className: "btn btn-ghost btn-sm hidden", text: "Filters wissen", attrs: { type: "button" } });

    content.appendChild(el("div", { className: "toolbar" }, search, statusSelect, categorySelect, resetButton, el("span", { className: "spacer" }), count));
    const tableHolder = el("div", null, A.loadingState());
    content.appendChild(tableHolder);

    function fillCategories(selected) {
      DPP.clear(categorySelect);
      const options = [{ value: "", label: "Alle categorieën" }, ...categories.map((c) => ({ value: c, label: c }))];
      // Een categorie uit de URL die (nog) niet bestaat, blijft kiesbaar zodat de filter zichtbaar klopt.
      if (selected && !categories.includes(selected)) options.push({ value: selected, label: selected });
      for (const o of options) categorySelect.appendChild(el("option", { text: o.label, attrs: { value: o.value } }));
      categorySelect.value = selected || "";
    }

    function currentFilters() {
      return { q: search.value.trim(), status: statusSelect.value, category: categorySelect.value };
    }

    function syncUrl(filters) {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value);
      const query = next.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      resetButton.classList.toggle("hidden", !query);
    }

    function renderRows(rows, filters) {
      const filtered = Boolean(filters.q || filters.status || filters.category);
      count.textContent = `${DPP.formatNumber(rows.length)} ${rows.length === 1 ? "product" : "producten"}`;
      if (rows.length === 0 && !filtered) {
        DPP.clear(tableHolder);
        tableHolder.appendChild(
          el(
            "div",
            { className: "card empty-cta" },
            el("h2", { text: "Nog geen producten" }),
            el("p", { text: "Maak je eerste product aan. Vul de gegevens aan, laat ze reviewen en publiceer het digitale productpaspoort met een QR-code." }),
            DPP.can("products:create")
              ? el("button", { className: "btn", text: "Nieuw product", attrs: { type: "button" }, on: { click: () => A.openProductCreateModal({ categories }) } })
              : null
          )
        );
        return;
      }
      DPP.renderTable(tableHolder, {
        columns: [
          {
            label: "Naam",
            render: (p) =>
              el(
                "div",
                { className: "cell-stack" },
                el("a", { className: "cell-link", text: p.name, attrs: { href: A.productHref(p.id) }, on: { click: (event) => event.stopPropagation() } }),
                p.brand ? el("span", { className: "muted", text: p.brand }) : null,
                el("span", { className: "muted show-tablet", text: [p.manufacturer, p.model].filter(Boolean).join(" · ") })
              )
          },
          { label: "SKU", className: "nowrap", render: (p) => (p.sku ? el("span", { className: "mono", text: p.sku }) : "") },
          { label: "Fabrikant", className: "hide-tablet", render: (p) => p.manufacturer || "" },
          { label: "Model", className: "hide-tablet", render: (p) => p.model || "" },
          { label: "Categorie", render: (p) => p.category || "" },
          { label: "Status", render: (p) => DPP.statusBadge(p.status) },
          { label: "Bijgewerkt", className: "nowrap", render: (p) => DPP.formatDate(p.updated_at || p.created_at) }
        ],
        rows,
        empty: "Geen producten gevonden voor deze filters.",
        onRowClick: (p) => {
          window.location.href = A.productHref(p.id);
        }
      });
    }

    // Volgnummer: een trager antwoord op een oude zoekopdracht mag een nieuwer resultaat
    // niet overschrijven.
    let requestSeq = 0;
    async function load() {
      const filters = currentFilters();
      syncUrl(filters);
      const seq = ++requestSeq;
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      try {
        const rows = await api.get(`/api/products${query.toString() ? `?${query}` : ""}`);
        if (seq !== requestSeq) return;
        renderRows(rows, filters);
      } catch (error) {
        if (seq !== requestSeq) return;
        DPP.clear(tableHolder);
        tableHolder.appendChild(A.errorCard("Producten konden niet worden geladen", A.errorMessage(error)));
      }
    }

    search.addEventListener("input", A.debounce(load, 300));
    statusSelect.addEventListener("change", load);
    categorySelect.addEventListener("change", load);
    resetButton.addEventListener("click", () => {
      search.value = "";
      statusSelect.value = "";
      categorySelect.value = "";
      load();
    });

    try {
      // Categorieën voor filter en suggesties komen uit de volledige (ongefilterde) lijst.
      categories = A.uniqueCategories(await api.get("/api/products"));
    } catch {
      categories = [];
    }
    fillCategories(initialCategory);
    await load();
  });
})();
