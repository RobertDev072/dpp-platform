// Publieke DPP-pagina (geen login). Leest de public_id uit het pad (/p/<uuid>), haalt de
// whitelisted JSON op en rendert alles via DPP.el / textContent — nooit innerHTML, want elke
// tekst hier komt uit door bedrijven ingevulde velden.
// Bewust geen api.js en geen layout.js: api.js stuurt bij een 401 door naar de loginpagina en
// layout.js verwacht een sessie; een publieke bezoeker heeft geen van beide nodig.
(function () {
  const { el, clear } = window.DPP;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PATH_PATTERN = /^\/p\/([^/]+)\/?$/;
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Volgorde = volgorde op de pagina. Lege velden worden weggelaten.
  const FACTS = [
    { key: "model", label: "Model" },
    { key: "sku", label: "Artikelnummer", mono: true },
    { key: "gtin", label: "GTIN / EAN", mono: true },
    { key: "category", label: "Categorie" },
    { key: "countryOfOrigin", label: "Land van herkomst" }
  ];

  const SECTIONS = [
    { key: "description", id: "beschrijving", title: "Beschrijving" },
    { key: "materials", id: "materialen", title: "Materialen", intro: "Samenstelling en gebruikte materialen" },
    { key: "complianceInfo", id: "compliance", title: "Compliance", intro: "Normen, certificeringen en conformiteit" },
    { key: "recyclingInfo", id: "recycling", title: "Recycling", intro: "Inleveren en verwerken aan het einde van de levensduur" },
    { key: "repairInfo", id: "reparatie", title: "Reparatie", intro: "Onderhoud, onderdelen en reparatiemogelijkheden" }
  ];

  const DOCUMENT_TYPE_LABELS = {
    manual: "Handleiding",
    certificate: "Certificaat",
    declaration: "Verklaring",
    safety: "Veiligheid",
    repair: "Reparatie",
    recycling: "Recycling",
    other: "Overig"
  };

  // types: null = alles wat niet in een eerdere groep valt (ook onbekende types van later).
  const DOCUMENT_GROUPS = [
    { title: "Handleidingen", types: ["manual"] },
    { title: "Certificaten en verklaringen", types: ["certificate", "declaration"] },
    { title: "Overige documenten", types: null }
  ];

  // Vaste, eigen iconen (geen data): SVG via createElementNS mag onder de strikte CSP.
  const ICONS = {
    document: ["M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M14 3v5h5", "M9 13h7", "M9 17h5"],
    external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"]
  };

  const nodes = {
    main: document.getElementById("dpp-main"),
    loading: document.getElementById("dpp-loading"),
    passport: document.getElementById("dpp-passport"),
    notFound: document.getElementById("dpp-not-found"),
    error: document.getElementById("dpp-error"),
    errorMessage: document.getElementById("dpp-error-message"),
    retry: document.getElementById("dpp-retry"),
    footerMeta: document.getElementById("dpp-footer-meta"),
    print: document.getElementById("dpp-print")
  };

  // ---------- Helpers ----------

  function text(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", `dpp-icon dpp-icon-${name}`);
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function formatLongDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return { iso: date.toISOString(), label: date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) };
  }

  let languageNames = null;
  try {
    languageNames = new Intl.DisplayNames(["nl"], { type: "language" });
  } catch {
    languageNames = null;
  }

  // "nl" -> "Nederlands", "en-GB" -> "Brits Engels"; onbekend of ongeldig -> de code zelf.
  function languageLabel(code) {
    const value = text(code);
    if (!value) return null;
    try {
      const name = languageNames && languageNames.of(value);
      if (name && name.toLowerCase() !== value.toLowerCase()) return name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
      // Ongeldige taalcode: val terug op de code.
    }
    return value.toUpperCase();
  }

  // Tweede controle naast de backend: alleen echte https-links worden klikbaar, zodat een
  // javascript:/data:/http:-waarde nooit als link op een publieke pagina kan staan.
  function safeHttpsUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  // Lege regel = nieuwe alinea; enkele regeleinden blijven zichtbaar via CSS (white-space: pre-line).
  function prose(value) {
    return el(
      "div",
      { className: "dpp-prose" },
      value
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => el("p", { text: part }))
    );
  }

  // ---------- Onderdelen ----------

  // compact: zonder kerngegevenskaart valt er niets over de hero heen, dus minder donkere ruimte.
  function renderHero(dpp, { compact }) {
    const brand = text(dpp.brand);
    const manufacturer = text(dpp.manufacturer);
    const issuer = text(dpp.issuer);
    const makers = [];
    if (brand && manufacturer && brand.toLowerCase() === manufacturer.toLowerCase()) {
      makers.push({ label: "Merk en fabrikant", value: brand });
    } else {
      if (brand) makers.push({ label: "Merk", value: brand });
      if (manufacturer) makers.push({ label: "Fabrikant", value: manufacturer });
    }

    return el(
      "section",
      { className: `dpp-hero${compact ? " dpp-hero-compact" : ""}`, attrs: { "aria-labelledby": "dpp-title" } },
      el(
        "div",
        { className: "dpp-hero-inner" },
        el("h1", { className: "dpp-title", text: dpp.name, attrs: { id: "dpp-title" } }),
        makers.length
          ? el(
              "p",
              { className: "dpp-makers" },
              makers.map((maker) =>
                el("span", { className: "dpp-maker" }, el("span", { className: "dpp-maker-label", text: maker.label }), el("span", { className: "dpp-maker-value", text: maker.value }))
              )
            )
          : null,
        issuer ? el("p", { className: "dpp-issuer" }, "Uitgegeven door ", el("strong", { text: issuer })) : null
      )
    );
  }

  function renderFacts(dpp) {
    const facts = FACTS.map((fact) => ({ ...fact, value: text(dpp[fact.key]) })).filter((fact) => fact.value);
    if (!facts.length) return null;
    return el(
      "section",
      { className: "dpp-facts-card", attrs: { "aria-labelledby": "dpp-facts-title" } },
      el("h2", { className: "dpp-sr-only", text: "Kerngegevens", attrs: { id: "dpp-facts-title" } }),
      el(
        "dl",
        { className: "dpp-facts" },
        facts.map((fact) =>
          el("div", { className: "dpp-fact" }, el("dt", { text: fact.label }), el("dd", { className: fact.mono ? "dpp-mono" : null, text: fact.value }))
        )
      )
    );
  }

  function renderSection(section, value) {
    const headingId = `dpp-h-${section.id}`;
    return el(
      "section",
      { className: "dpp-card dpp-section", attrs: { id: section.id, "aria-labelledby": headingId } },
      el(
        "div",
        { className: "dpp-card-header" },
        el("h2", { text: section.title, attrs: { id: headingId } }),
        section.intro ? el("p", { className: "dpp-card-intro", text: section.intro }) : null
      ),
      prose(value)
    );
  }

  function renderDocument(doc) {
    const title = text(doc.title) || "Document";
    const typeLabel = DOCUMENT_TYPE_LABELS[doc.type] || "Document";
    const language = languageLabel(doc.language);
    const meta = [typeLabel, language].filter(Boolean).join(" · ");
    const href = safeHttpsUrl(doc.url);

    const body = el(
      "span",
      { className: "dpp-doc-body" },
      el("span", { className: "dpp-doc-title", text: title }),
      el("span", { className: "dpp-doc-meta", text: href ? meta : `${meta} · Link niet beschikbaar` })
    );

    if (!href) {
      return el("li", null, el("div", { className: "dpp-doc dpp-doc-disabled" }, icon("document"), body));
    }
    return el(
      "li",
      null,
      el(
        "a",
        { className: "dpp-doc", attrs: { href, target: "_blank", rel: "noopener noreferrer" } },
        icon("document"),
        body,
        icon("external"),
        el("span", { className: "dpp-sr-only", text: " (opent in een nieuw venster)" })
      )
    );
  }

  function renderDocuments(documents) {
    const list = Array.isArray(documents) ? documents.filter((doc) => doc && typeof doc === "object") : [];
    if (!list.length) return null;

    const claimed = new Set();
    const groups = DOCUMENT_GROUPS.map((group, index) => {
      const items = list.filter((doc) => !claimed.has(doc) && (group.types === null || group.types.includes(doc.type)));
      items.forEach((doc) => claimed.add(doc));
      return { ...group, id: `dpp-docs-${index}`, items };
    }).filter((group) => group.items.length);

    return el(
      "section",
      { className: "dpp-card dpp-docs", attrs: { id: "documenten", "aria-labelledby": "dpp-h-documenten" } },
      el(
        "div",
        { className: "dpp-card-header" },
        el("h2", { text: "Documenten", attrs: { id: "dpp-h-documenten" } }),
        el("p", { className: "dpp-card-intro", text: "Handleidingen, certificaten en andere productdocumenten" })
      ),
      groups.map((group) =>
        el(
          "div",
          { className: "dpp-doc-group" },
          // Het aantal is alleen visueel: een schermlezer noemt het aantal items van de lijst al.
          el("h3", { attrs: { id: group.id } }, group.title, el("span", { className: "dpp-count", text: group.items.length, attrs: { "aria-hidden": "true" } })),
          el("ul", { className: "dpp-doc-list", attrs: { "aria-labelledby": group.id } }, group.items.map(renderDocument))
        )
      )
    );
  }

  // Snelmenu naar de secties: op een telefoon is een lang paspoort anders veel scrollen.
  function renderToc(entries) {
    if (entries.length < 2) return null;
    return el(
      "nav",
      { className: "dpp-toc", attrs: { "aria-label": "Inhoud van dit paspoort" } },
      el(
        "ul",
        null,
        entries.map((entry) => el("li", null, el("a", { className: "dpp-toc-link", text: entry.title, attrs: { href: `#${entry.id}` } })))
      )
    );
  }

  function renderFooterMeta(dpp) {
    clear(nodes.footerMeta);
    const updated = formatLongDate(dpp.updatedAt) || formatLongDate(dpp.publishedAt);
    const issuer = text(dpp.issuer);
    const items = [];
    if (updated) {
      items.push(el("p", null, "Laatst bijgewerkt: ", el("time", { text: updated.label, attrs: { datetime: updated.iso } })));
    }
    if (issuer) items.push(el("p", null, "Uitgegeven door ", el("strong", { text: issuer })));
    if (text(dpp.publicId)) {
      items.push(el("p", { className: "dpp-footer-id" }, "Paspoort-ID: ", el("span", { className: "dpp-mono", text: dpp.publicId })));
    }
    nodes.footerMeta.append(...items);
  }

  function renderPassport(dpp) {
    const sections = SECTIONS.map((section) => ({ section, value: text(dpp[section.key]) })).filter((entry) => entry.value);
    const documentsCard = renderDocuments(dpp.documents);
    const factsCard = renderFacts(dpp);

    const tocEntries = sections.map((entry) => ({ id: entry.section.id, title: entry.section.title }));
    if (documentsCard) tocEntries.push({ id: "documenten", title: "Documenten" });

    const layout = el(
      "div",
      { className: `dpp-layout${documentsCard ? " dpp-layout-aside" : ""}` },
      el(
        "div",
        { className: "dpp-sections" },
        sections.length
          ? sections.map((entry) => renderSection(entry.section, entry.value))
          : el("div", { className: "dpp-card dpp-empty", text: "Voor dit product is nog geen aanvullende informatie beschikbaar." })
      ),
      documentsCard ? el("div", { className: "dpp-aside" }, documentsCard) : null
    );

    clear(nodes.passport);
    nodes.passport.append(renderHero(dpp, { compact: !factsCard }), el("div", { className: "dpp-container" }, factsCard, renderToc(tocEntries), layout));
    renderFooterMeta(dpp);

    document.title = `${dpp.name} — Digitaal Productpaspoort`;
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      const brand = text(dpp.brand) || text(dpp.manufacturer);
      description.setAttribute("content", `Digitaal Productpaspoort van ${dpp.name}${brand ? ` (${brand})` : ""}: materialen, compliance, recycling en reparatie.`);
    }
  }

  // ---------- Status ----------

  function showState(state) {
    nodes.loading.classList.toggle("hidden", state !== "loading");
    nodes.passport.classList.toggle("hidden", state !== "passport");
    nodes.notFound.classList.toggle("hidden", state !== "not-found");
    nodes.error.classList.toggle("hidden", state !== "error");
    nodes.print.classList.toggle("hidden", state !== "passport");
    nodes.main.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    if (state !== "passport") clear(nodes.footerMeta);
  }

  function showNotFound() {
    document.title = "Productpaspoort niet gevonden — DPP Platform";
    showState("not-found");
  }

  function showError(message) {
    document.title = "Productpaspoort niet beschikbaar — DPP Platform";
    nodes.errorMessage.textContent = message;
    showState("error");
    nodes.retry.focus();
  }

  // ---------- Laden ----------

  function readPublicId() {
    const match = PATH_PATTERN.exec(window.location.pathname);
    if (!match) return null;
    let value;
    try {
      value = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
    return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
  }

  // Alleen "qr" of "web": een andere waarde uit de URL gaat nooit ongefilterd naar de API.
  function readSource() {
    return new URLSearchParams(window.location.search).get("src") === "qr" ? "qr" : "web";
  }

  const publicId = readPublicId();
  const source = readSource();

  // ?src=qr uit de adresbalk halen: wie de link daarna kopieert, deelt of de pagina ververst,
  // telt anders nog een keer als QR-scan en vertekent de scanstatistieken van het bedrijf.
  if (window.location.search && window.history && typeof window.history.replaceState === "function") {
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }

  async function load() {
    if (!publicId) {
      showNotFound();
      return;
    }
    showState("loading");

    let response;
    try {
      // credentials: "omit": de publieke API heeft geen sessie nodig, dus sturen we ook geen
      // sessiecookie mee van een ingelogde medewerker die toevallig een QR-code scant.
      response = await fetch(`/api/public/dpp/${encodeURIComponent(publicId)}?src=${source}`, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
    } catch {
      showError("Controleer je internetverbinding en probeer het opnieuw.");
      return;
    }

    // De foutbody is niet nodig, maar wel uitlezen: een ongelezen body houdt de request open
    // (in DevTools "pending", en tools die op netwerkrust wachten blijven hangen).
    if (!response.ok) await response.text().catch(() => {});

    if (response.status === 404) {
      showNotFound();
      return;
    }
    if (response.status === 429) {
      showError("Er worden op dit moment te veel verzoeken gedaan. Wacht een minuut en probeer het dan opnieuw.");
      return;
    }
    if (!response.ok) {
      showError("Er ging iets mis bij het ophalen van de productinformatie. Probeer het later opnieuw.");
      return;
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object" || !text(data.name)) {
      showError("De productinformatie kon niet worden gelezen. Probeer het later opnieuw.");
      return;
    }

    renderPassport({ ...data, name: text(data.name) });
    showState("passport");

    // Kwam de bezoeker binnen met een sectie-anker (#materialen), spring daar dan alsnog heen:
    // bij het openen van de pagina bestond die sectie nog niet.
    if (window.location.hash) {
      const target = document.getElementById(window.location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  nodes.retry.addEventListener("click", () => {
    load();
  });
  nodes.print.addEventListener("click", () => window.print());

  load();
})();
