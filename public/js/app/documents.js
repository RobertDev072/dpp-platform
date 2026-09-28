// Alle documenten van de eigen company, over producten heen. Filters gaan als query naar de
// API (company-scope komt daar uit de sessie). Aanmaken loopt altijd via een product
// (POST /api/products/:id/documents), zodat een document nooit los van een product bestaat.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");
    const canManage = DPP.can("documents:manage");

    let products = [];

    const addButton = canManage
      ? el("button", { className: "btn", text: "Document toevoegen", attrs: { type: "button" }, on: { click: () => openAdd() } })
      : null;

    content.appendChild(
      DPP.pageHeader({
        title: "Documenten",
        subtitle: "Handleidingen, certificaten en verklaringen als https-link. Alleen publieke documenten staan op de DPP-pagina.",
        actions: addButton ? [addButton] : []
      })
    );

    const initialProduct = A.parseIdParam(DPP.getQueryParam("productId") || "");
    const initialType = Object.prototype.hasOwnProperty.call(A.DOCUMENT_TYPE_LABELS, DPP.getQueryParam("type") || "") ? DPP.getQueryParam("type") : "";

    const productSelect = A.select("productId", [{ value: "", label: "Alle producten" }], { label: "Product" });
    const typeSelect = A.select("type", [{ value: "", label: "Alle types" }, ...A.DOCUMENT_TYPE_OPTIONS], { label: "Type", value: initialType });
    const visibilitySelect = A.select(
      "visibility",
      [
        { value: "", label: "Publiek en intern" },
        { value: "public", label: "Alleen publiek" },
        { value: "private", label: "Alleen intern" }
      ],
      { label: "Zichtbaarheid" }
    );
    const count = el("span", { className: "toolbar-count muted" });
    const tableHolder = el("div", null, A.loadingState());

    content.appendChild(el("div", { className: "toolbar" }, productSelect, typeSelect, visibilitySelect, el("span", { className: "spacer" }), count));
    content.appendChild(tableHolder);

    function productById(productId) {
      return products.find((p) => p.id === productId);
    }

    function openAdd() {
      const selectable = products.filter((p) => p.status !== "archived");
      if (selectable.length === 0) {
        DPP.showError("Er is nog geen (niet-gearchiveerd) product om een document aan toe te voegen.");
        return;
      }
      const preset = Number(productSelect.value) || null;
      A.openDocumentModal({
        productId: preset && selectable.some((p) => p.id === preset) ? preset : undefined,
        products: selectable,
        onDone: load
      });
    }

    let requestSeq = 0;
    async function load() {
      const query = new URLSearchParams();
      if (productSelect.value) query.set("productId", productSelect.value);
      if (typeSelect.value) query.set("type", typeSelect.value);
      window.history.replaceState(null, "", `${window.location.pathname}${query.toString() ? `?${query}` : ""}`);
      const seq = ++requestSeq;
      try {
        const rows = await api.get(`/api/documents${query.toString() ? `?${query}` : ""}`);
        if (seq !== requestSeq) return;
        render(rows);
      } catch (error) {
        if (seq !== requestSeq) return;
        DPP.clear(tableHolder);
        tableHolder.appendChild(A.errorCard("Documenten konden niet worden geladen", A.errorMessage(error)));
      }
    }

    function render(allRows) {
      const visibility = visibilitySelect.value;
      const rows = allRows.filter((d) => !visibility || (visibility === "public" ? d.is_public : !d.is_public));
      count.textContent = `${DPP.formatNumber(rows.length)} ${rows.length === 1 ? "document" : "documenten"}`;
      const filtered = Boolean(productSelect.value || typeSelect.value || visibility);
      DPP.renderTable(tableHolder, {
        columns: [
          {
            label: "Titel",
            render: (d) =>
              el(
                "div",
                { className: "cell-stack" },
                el("span", { className: "cell-strong", text: d.title }),
                el("span", { className: "muted show-tablet", text: d.product_name || "" }),
                d.language ? el("span", { className: "muted", text: `Taal: ${d.language}` }) : null
              )
          },
          {
            label: "Product",
            className: "hide-tablet",
            render: (d) =>
              el(
                "div",
                { className: "cell-stack" },
                el("a", { className: "cell-link", text: d.product_name || `Product #${d.product_id}`, attrs: { href: A.productHref(d.product_id, "documenten") } }),
                d.product_status === "archived" ? el("span", { className: "muted", text: "Gearchiveerd" }) : null
              )
          },
          { label: "Type", render: (d) => A.documentTypeLabel(d.type) },
          { label: "Zichtbaarheid", render: (d) => A.visibilityBadge(d.is_public) },
          { label: "Bijgewerkt", className: "nowrap hide-tablet", render: (d) => DPP.formatDate(d.updated_at || d.created_at) },
          {
            label: "",
            className: "col-actions",
            render: (d) => {
              const editable = canManage && d.product_status !== "archived";
              return el(
                "div",
                { className: "row-actions" },
                A.externalLink(d.url, "Openen ↗", "btn btn-ghost btn-sm"),
                editable
                  ? A.actionMenu([
                      { label: "Bewerken", onClick: () => A.openDocumentModal({ document: d, onDone: load }) },
                      { label: "Naar product", onClick: () => (window.location.href = A.productHref(d.product_id, "documenten")) },
                      { label: "Verwijderen", danger: true, onClick: () => A.deleteDocument(d, load) }
                    ])
                  : null
              );
            }
          }
        ],
        rows,
        empty: filtered
          ? "Geen documenten gevonden voor deze filters."
          : canManage
            ? "Nog geen documenten. Voeg een handleiding, certificaat of verklaring toe aan een product."
            : "Er zijn nog geen documenten toegevoegd."
      });
    }

    productSelect.addEventListener("change", load);
    typeSelect.addEventListener("change", load);
    visibilitySelect.addEventListener("change", load);

    try {
      products = await api.get("/api/products");
    } catch {
      products = [];
    }
    for (const p of products) {
      productSelect.appendChild(el("option", { text: p.sku ? `${p.name} (${p.sku})` : p.name, attrs: { value: p.id } }));
    }
    if (initialProduct && productById(initialProduct)) productSelect.value = String(initialProduct);
    await load();
  });
})();
