// QR-codes van alle gepubliceerde producten (qr:download). De voorvertoning (qr.svg zonder
// ?download) schrijft geen audit-regel; alleen de downloadlinks (?download=1) doen dat.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  function qrCard(p) {
    return el(
      "article",
      { className: "qr-card" },
      el(
        "div",
        { className: "cell-stack" },
        el("a", { className: "qr-card-title", text: p.name, attrs: { href: A.productHref(p.id, "qr") } }),
        el("span", { className: "muted", text: [p.sku ? `SKU ${p.sku}` : null, p.category].filter(Boolean).join(" · ") || "Geen SKU" })
      ),
      A.qrPreview(p.id, p.name),
      p.public_url ? el("div", { className: "qr-card-label", text: "Publieke URL" }) : null,
      p.public_url ? A.publicUrlBox(p.public_url, { small: true, stacked: true }) : null,
      el("div", { className: "qr-card-actions" }, A.qrDownloadLinks(p.id, { small: true }))
    );
  }

  function usageNote() {
    return el(
      "div",
      { className: "card" },
      el(
        "div",
        { className: "usage-note" },
        el(
          "div",
          null,
          el("h3", { text: "Waar plaats je de code?" }),
          el("p", { text: "Op het product zelf, de verpakking of het typeplaatje/label. Zo kan iedereen het digitale productpaspoort openen met de camera van een telefoon." })
        ),
        el(
          "div",
          null,
          el("h3", { text: "Formaat en bestand" }),
          el("p", { text: "Minimaal 2 × 2 cm met witruimte rondom. PNG (1024 px) voor etiketten en kantoorprinters, SVG voor vormgeving en groot drukwerk." })
        ),
        el(
          "div",
          null,
          el("h3", { text: "Blijft de code geldig?" }),
          el("p", { text: "Ja. De code verwijst naar een vaste publieke URL. Na depubliceren toont die tijdelijk niets; na opnieuw publiceren werkt dezelfde code weer." })
        )
      )
    );
  }

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");

    content.appendChild(DPP.pageHeader({ title: "QR-codes", subtitle: "Download de QR-code van elk gepubliceerd productpaspoort." }));
    content.appendChild(usageNote());

    const search = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op naam of SKU…", "aria-label": "Zoeken", maxlength: 200 } });
    const count = el("span", { className: "toolbar-count muted" });
    const toolbar = el("div", { className: "toolbar hidden" }, search, el("span", { className: "spacer" }), count);
    const grid = el("div", null, A.loadingState());
    content.appendChild(toolbar);
    content.appendChild(grid);

    let products = [];

    function render() {
      const q = search.value.trim().toLowerCase();
      const rows = products.filter((p) => !q || `${p.name} ${p.sku || ""}`.toLowerCase().includes(q));
      count.textContent = `${DPP.formatNumber(rows.length)} ${rows.length === 1 ? "gepubliceerd product" : "gepubliceerde producten"}`;
      DPP.clear(grid);
      if (rows.length === 0) {
        grid.appendChild(el("div", { className: "card empty-state", text: "Geen gepubliceerde producten gevonden voor deze zoekopdracht." }));
        return;
      }
      grid.appendChild(el("div", { className: "qr-grid" }, rows.map(qrCard)));
    }

    try {
      products = await api.get("/api/products?status=published");
    } catch (error) {
      DPP.clear(grid);
      grid.appendChild(A.errorCard("QR-codes konden niet worden geladen", A.errorMessage(error)));
      return;
    }

    if (products.length === 0) {
      DPP.clear(grid);
      grid.appendChild(
        el(
          "div",
          { className: "card empty-cta" },
          el("h2", { text: "Nog geen gepubliceerde producten" }),
          el("p", { text: "Een QR-code is beschikbaar zodra een product is gepubliceerd. Vul de verplichte gegevens aan en publiceer het product vanaf de productpagina." }),
          el("a", { className: "btn", text: "Naar producten", attrs: { href: "/app/products.html" } })
        )
      );
      return;
    }

    toolbar.classList.remove("hidden");
    search.addEventListener("input", A.debounce(render, 150));
    render();
  });
})();
