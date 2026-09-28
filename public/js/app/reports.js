// Rapportages (reports:read). Eenvoudige CSS-grafieken: één reeks per grafiek, één tint
// (magnitude), waarden in teksttint naast de balk. Breedtes/hoogtes via element.style
// (CSSOM is toegestaan onder de CSP; style=""-attributen niet). Categorienamen zijn
// gebruikersinvoer en gaan dus alleen via textContent de pagina in.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  function card(title, subtitle, body, { flush = false } = {}) {
    return el(
      "section",
      { className: `card${flush ? " card-flush" : ""}` },
      el("div", { className: "card-header" }, el("h2", { text: title }), subtitle ? el("span", { className: "card-subtitle", text: subtitle }) : null),
      body
    );
  }

  // Horizontale balken; rows: [{ label, value, muted?, labelNode? }]
  function barList(rows, { empty = "Nog geen gegevens." } = {}) {
    if (!rows.length) return el("div", { className: "empty-state", text: empty });
    const max = Math.max(1, ...rows.map((r) => r.value));
    return el(
      "div",
      { className: "bar-list" },
      rows.map((r) => {
        const fill = el("div", { className: `bar-fill${r.value === 0 ? " zero" : ""}` });
        fill.style.width = `${r.value === 0 ? 0 : Math.max(1, (r.value / max) * 100) * 0.85}%`;
        return el(
          "div",
          { className: "bar-row", attrs: { title: `${r.label}: ${DPP.formatNumber(r.value)}` } },
          r.labelNode || el("span", { className: `bar-label${r.muted ? " muted" : ""}`, text: r.label }),
          el("div", { className: "bar-track" }, fill, el("span", { className: "bar-value", text: DPP.formatNumber(r.value) }))
        );
      })
    );
  }

  // As-schaal met hele, "ronde" stappen (1/2/5 × 10^n), zodat elke gridlijn een exacte
  // waarde heeft: nooit een afgeronde 2,5 die als 3 wordt getoond.
  function niceStep(value) {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
    for (const s of [1, 2, 5, 10]) {
      if (value <= s * magnitude) return s * magnitude;
    }
    return 10 * magnitude;
  }

  function axisTicks(peak) {
    const step = niceStep(Math.max(1, peak) / 3);
    const max = Math.max(step, Math.ceil(Math.max(1, peak) / step) * step);
    const ticks = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    return { max, ticks };
  }

  function formatDay(isoDate, options) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString("nl-NL", { timeZone: "UTC", ...options });
  }

  // Eén tooltip voor de hele pagina, gepositioneerd met position: fixed.
  const tooltip = el("div", { className: "chart-tooltip hidden", attrs: { role: "tooltip" } });

  function showTooltip(target, value, label) {
    DPP.clear(tooltip);
    tooltip.appendChild(el("strong", { text: value }));
    tooltip.appendChild(el("span", { text: label }));
    tooltip.classList.remove("hidden");
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tipRect.width - 8, Math.max(8, rect.left + rect.width / 2 - tipRect.width / 2));
    const top = Math.max(8, rect.top - tipRect.height - 8);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    tooltip.classList.add("hidden");
  }

  function scansChart(series) {
    const total = series.reduce((sum, d) => sum + d.count, 0);
    const peak = series.reduce((best, d) => (d.count > best.count ? d : best), { count: 0, date: null });
    const last7 = series.slice(-7).reduce((sum, d) => sum + d.count, 0);
    const { max, ticks } = axisTicks(peak.count);

    const plot = el("div", { className: "col-plot" });
    for (const tick of ticks) {
      const line = el("div", { className: "col-grid" }, el("span", { className: "col-grid-label", text: DPP.formatNumber(tick) }));
      line.style.bottom = `${(tick / max) * 100}%`;
      plot.appendChild(line);
    }
    const bars = el("div", { className: "col-bars" });
    for (const day of series) {
      const bar = el("div", { className: `col-bar${day.count === 0 ? " zero" : ""}` });
      bar.style.height = day.count === 0 ? "0" : `${Math.max(2, (day.count / max) * 100)}%`;
      const label = formatDay(day.date, { weekday: "short", day: "numeric", month: "short" });
      const valueText = `${DPP.formatNumber(day.count)} ${day.count === 1 ? "scan" : "scans"}`;
      const slot = el("div", { className: "col-slot", attrs: { tabindex: "0", "aria-label": `${label}: ${valueText}` } }, bar);
      slot.addEventListener("pointerenter", () => showTooltip(slot, valueText, label));
      slot.addEventListener("focus", () => showTooltip(slot, valueText, label));
      slot.addEventListener("pointerleave", hideTooltip);
      slot.addEventListener("blur", hideTooltip);
      bars.appendChild(slot);
    }
    plot.appendChild(bars);

    const first = series[0];
    const middle = series[Math.floor(series.length / 2)];
    const last = series[series.length - 1];
    const axis = el(
      "div",
      { className: "col-axis" },
      el("span", { text: first ? formatDay(first.date, { day: "numeric", month: "short" }) : "" }),
      el("span", { text: middle ? formatDay(middle.date, { day: "numeric", month: "short" }) : "" }),
      el("span", { text: last ? "Vandaag" : "" })
    );

    const summary = el(
      "div",
      { className: "chart-summary" },
      summaryItem("Totaal (30 dagen)", DPP.formatNumber(total)),
      summaryItem("Laatste 7 dagen", DPP.formatNumber(last7)),
      summaryItem("Drukste dag", peak.date ? `${DPP.formatNumber(peak.count)} · ${formatDay(peak.date, { day: "numeric", month: "short" })}` : "—")
    );

    // Tabelweergave: dezelfde waarden zonder hover, voor toegankelijkheid en exact aflezen.
    const tableHolder = el("div");
    DPP.renderTable(tableHolder, {
      columns: [
        { label: "Datum", render: (d) => formatDay(d.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" }) },
        { label: "Scans", className: "num", render: (d) => DPP.formatNumber(d.count) }
      ],
      rows: [...series].reverse()
    });
    const details = el("details", { className: "table-toggle" }, el("summary", { text: "Toon als tabel" }), tableHolder);

    return el("div", null, summary, el("div", { className: "col-chart" }, plot, axis), details);
  }

  function summaryItem(label, value) {
    return el("div", { className: "chart-summary-item" }, el("div", { className: "label", text: label }), el("div", { className: "value", text: value }));
  }

  function topProductsTable(rows) {
    const holder = el("div");
    DPP.renderTable(holder, {
      columns: [
        {
          label: "Product",
          render: (p) =>
            el(
              "div",
              { className: "cell-stack" },
              el("a", { className: "cell-link", text: p.name, attrs: { href: A.productHref(p.id) }, on: { click: (e) => e.stopPropagation() } }),
              p.sku ? el("span", { className: "muted", text: p.sku }) : null
            )
        },
        { label: "Status", render: (p) => DPP.statusBadge(p.status) },
        { label: "30 dagen", className: "num", render: (p) => DPP.formatNumber(p.scans_last_30_days || 0) },
        { label: "Totaal", className: "num", render: (p) => el("strong", { text: DPP.formatNumber(p.scans || 0) }) }
      ],
      rows,
      empty: "Nog geen scans. Zodra iemand een QR-code scant, verschijnt het product hier."
    });
    return holder;
  }

  function incompleteTable(rows) {
    const holder = el("div");
    DPP.renderTable(holder, {
      columns: [
        {
          label: "Product",
          render: (p) => el("a", { className: "cell-link", text: p.name, attrs: { href: A.productHref(p.id) }, on: { click: (e) => e.stopPropagation() } })
        },
        { label: "Status", render: (p) => DPP.statusBadge(p.status) },
        {
          label: "Ontbrekende verplichte velden",
          render: (p) => el("div", { className: "chip-list" }, (p.missing || []).map((field) => el("span", { className: "chip", text: A.fieldLabel(field) })))
        },
        { label: "Bijgewerkt", className: "nowrap hide-tablet", render: (p) => DPP.formatDate(p.updated_at) }
      ],
      rows,
      empty: "Alle niet-gearchiveerde producten hebben de verplichte velden ingevuld.",
      onRowClick: (p) => {
        window.location.href = A.productHref(p.id);
      }
    });
    return holder;
  }

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");
    document.body.appendChild(tooltip);
    window.addEventListener("scroll", hideTooltip, true);

    content.appendChild(DPP.pageHeader({ title: "Rapportages", subtitle: "Voortgang van je productpaspoorten en hoe vaak ze worden bekeken." }));
    const body = el("div", null, A.loadingState());
    content.appendChild(body);

    let data;
    try {
      data = await api.get("/api/company/reports");
    } catch (error) {
      DPP.clear(body);
      body.appendChild(A.errorCard("Rapportages konden niet worden geladen", A.errorMessage(error)));
      return;
    }

    const byStatus = (data.productsByStatus || []).map((r) => ({
      label: DPP.statusLabel(r.status),
      value: r.count,
      labelNode: el("span", { className: "bar-label" }, DPP.statusBadge(r.status))
    }));
    const byCategory = (data.productsByCategory || []).map((r) => ({
      label: r.category || "Zonder categorie",
      value: r.count,
      muted: !r.category
    }));
    const totalProducts = (data.productsByStatus || []).reduce((sum, r) => sum + r.count, 0);
    const incomplete = data.incomplete || [];

    DPP.clear(body);
    body.appendChild(
      el(
        "div",
        { className: "grid-2 card-row" },
        card("Producten per status", `${DPP.formatNumber(totalProducts)} in totaal`, barList(byStatus)),
        card("Producten per categorie", "Exclusief gearchiveerd", barList(byCategory, { empty: "Nog geen producten." }))
      )
    );
    body.appendChild(card("Scans per dag", "Laatste 30 dagen (UTC)", scansChart(data.scansByDay || [])));
    body.appendChild(card("Meest gescande producten", "Top 10 op totaal aantal scans", topProductsTable(data.topProducts || []), { flush: true }));
    body.appendChild(
      card(
        "Onvolledige producten",
        incomplete.length ? `${DPP.formatNumber(incomplete.length)} nog niet klaar voor publicatie` : "Alles compleet",
        incompleteTable(incomplete),
        { flush: true }
      )
    );
  });
})();
