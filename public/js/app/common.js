// Gedeelde bouwstenen voor de company-console (/app). Hangt onder DPP.app.
// Alle tekst via textContent (DPP.el); gevoelige waarden (tijdelijke wachtwoorden) gaan
// alleen naar DPP.showSecretOnce en worden nergens in de pagina-state bewaard.
// Knoppen verbergen op basis van DPP.can() is alleen gemak: de backend dwingt alles af.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;

  // ---------- Vaste lijsten (spiegelen het API-contract, docs/architecture-roles.md) ----------

  const PRODUCT_STATUS_OPTIONS = [
    { value: "draft", label: "Concept" },
    { value: "review", label: "In review" },
    { value: "published", label: "Gepubliceerd" },
    { value: "archived", label: "Gearchiveerd" }
  ];

  const DOCUMENT_TYPE_LABELS = {
    manual: "Handleiding",
    certificate: "Certificaat",
    declaration: "Conformiteitsverklaring",
    safety: "Veiligheidsinformatie",
    repair: "Reparatie",
    recycling: "Recycling",
    other: "Overig"
  };

  const DOCUMENT_TYPE_OPTIONS = Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

  // Rollen die een Company Admin mag toekennen (ASSIGNABLE_BY_COMPANY_ADMIN). company_admin
  // staat er bewust niet in: die loopt via de uitnodigingsflow van platformbeheer.
  const ASSIGNABLE_ROLES = ["product_manager", "compliance_manager", "company_user", "viewer"];

  const ROLE_DESCRIPTIONS = {
    company_admin: "Beheert het bedrijf, gebruikers en alle producten.",
    product_manager: "Beheert producten, publiceert DPP's en downloadt QR-codes.",
    compliance_manager: "Vult materialen, herkomst en compliance-informatie in en biedt aan voor review.",
    company_user: "Maakt en bewerkt algemene productgegevens; kan niet publiceren.",
    viewer: "Kan alles bekijken, maar niets wijzigen."
  };

  // Productvelden. `name` = camelCase-veld uit het API-contract, `column` = snake_case in de
  // response. Algemene velden vallen onder products:update, compliancevelden onder
  // products:compliance (de backend weigert anders met 403 FIELD_NOT_PERMITTED).
  const GENERAL_FIELDS = [
    { name: "name", column: "name", label: "Productnaam", required: true, maxlength: 200 },
    { name: "sku", column: "sku", label: "SKU / artikelnummer", maxlength: 100 },
    { name: "manufacturer", column: "manufacturer", label: "Fabrikant", maxlength: 200 },
    { name: "brand", column: "brand", label: "Merk", maxlength: 150 },
    { name: "model", column: "model", label: "Model", maxlength: 150 },
    { name: "gtin", column: "gtin", label: "GTIN / EAN", maxlength: 50 },
    { name: "category", column: "category", label: "Categorie", maxlength: 100, list: "category-options" },
    { name: "description", column: "description", label: "Omschrijving", type: "textarea", rows: 4, full: true, maxlength: 20000 }
  ];

  const COMPLIANCE_FIELDS = [
    {
      name: "materials",
      column: "materials",
      label: "Materialen",
      type: "textarea",
      rows: 4,
      full: true,
      maxlength: 20000,
      placeholder: "Bijv. behuizing: 80% gerecycled aluminium; kabel: PVC-vrij koper",
      help: "Samenstelling en materiaalpercentages zoals ze op de publieke DPP-pagina moeten staan."
    },
    { name: "countryOfOrigin", column: "country_of_origin", label: "Land van herkomst", maxlength: 100, placeholder: "Bijv. Nederland" },
    { name: "complianceInfo", column: "compliance_info", label: "Compliance-informatie", type: "textarea", rows: 4, full: true, maxlength: 20000, help: "Normen, CE-markering, conformiteitsverklaringen." },
    { name: "recyclingInfo", column: "recycling_info", label: "Recyclinginformatie", type: "textarea", rows: 3, full: true, maxlength: 20000 },
    { name: "repairInfo", column: "repair_info", label: "Reparatie-informatie", type: "textarea", rows: 3, full: true, maxlength: 20000 }
  ];

  const NOTES_FIELD = { name: "adminNotes", column: "admin_notes", label: "Interne notities", type: "textarea", rows: 8, full: true, maxlength: 20000 };

  // Labels voor checklist-/ontbrekende velden (camelCase uit de API).
  const FIELD_LABELS = {
    ...Object.fromEntries([...GENERAL_FIELDS, ...COMPLIANCE_FIELDS, NOTES_FIELD].map((f) => [f.name, f.label])),
    publicDocuments: "Minstens één publiek document"
  };

  const COMPLIANCE_FIELD_NAMES = COMPLIANCE_FIELDS.map((f) => f.name);

  // Vaste lijst uit §7. Onbekende acties tonen we als ruwe code (komt uit onze eigen DB).
  const AUDIT_ACTION_LABELS = {
    login: "Ingelogd",
    logout: "Uitgelogd",
    create: "Aangemaakt",
    update: "Gewijzigd",
    activate: "Geactiveerd",
    deactivate: "Gedeactiveerd",
    block: "Geblokkeerd",
    role_change: "Rol gewijzigd",
    plan_change: "Plan gewijzigd",
    seat_limit_change: "Licentielimiet gewijzigd",
    archive: "Gearchiveerd",
    submit_review: "Ingediend voor review",
    publish: "Gepubliceerd",
    unpublish: "Gedepubliceerd",
    status_change: "Status gewijzigd",
    qr_generate: "QR-code gedownload",
    reset_password: "Wachtwoord gereset",
    invite_create: "Uitnodiging aangemaakt",
    invite_revoke: "Uitnodiging ingetrokken",
    invite_accept: "Uitnodiging geaccepteerd",
    document_create: "Document toegevoegd",
    document_update: "Document gewijzigd",
    document_delete: "Document verwijderd"
  };

  const ENTITY_LABELS = {
    Company: "Bedrijf",
    User: "Gebruiker",
    Plan: "Plan",
    CompanyInvitation: "Uitnodiging",
    Product: "Product",
    Document: "Document"
  };

  // Vriendelijkere teksten voor bekende foutcodes; verder de (Nederlandse) melding van de API.
  const ERROR_MESSAGES = {
    LICENSE_LIMIT_REACHED:
      "Alle licenties zijn in gebruik. Deactiveer eerst een andere gebruiker of vraag platformbeheer om extra licenties.",
    EMAIL_IN_USE: "Dit e-mailadres is al in gebruik.",
    PRODUCT_ARCHIVED: "Dit product is gearchiveerd en alleen-lezen. Herstel het eerst naar concept.",
    FIELD_NOT_PERMITTED: "Je hebt geen rechten om een of meer van deze velden te wijzigen.",
    CANNOT_MODIFY_SELF: "Je kunt je eigen rol of status niet wijzigen.",
    ROLE_NOT_ASSIGNABLE: "Je mag deze gebruiker of rol niet beheren.",
    RESET_NOT_SUPPORTED: "Dit account logt in via Entra; laat de gebruiker 'Wachtwoord vergeten?' gebruiken.",
    COMPANY_INACTIVE: "Je bedrijf is niet actief. Neem contact op met platformbeheer."
  };

  function errorMessage(error) {
    if (error && error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
    return (error && error.message) || "Er ging iets mis";
  }

  function showApiError(error) {
    DPP.showError(errorMessage(error));
  }

  function actionLabel(action) {
    return AUDIT_ACTION_LABELS[action] || action || "—";
  }

  function entityLabel(type) {
    return ENTITY_LABELS[type] || type || "—";
  }

  function documentTypeLabel(type) {
    return DOCUMENT_TYPE_LABELS[type] || type || "—";
  }

  function fieldLabel(name) {
    return FIELD_LABELS[name] || name;
  }

  // ---------- Kleine helpers ----------

  function debounce(fn, ms = 250) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Ids uit de querystring: alleen positieve gehele getallen, anders null (de backend geeft
  // zelf ook 404 op een ongeldige id; zo sturen we geen rommel naar de API).
  function parseIdParam(value) {
    if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
    return Number(value);
  }

  function productHref(id, tab) {
    return `/app/product.html?id=${encodeURIComponent(id)}${tab ? `#${tab}` : ""}`;
  }

  // Alleen https-links worden klikbaar gemaakt (documenten). De backend accepteert niets
  // anders, maar we vertrouwen bij het renderen niet blind op wat er in de DB staat.
  function safeHttpsUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  // Publieke DPP-URL komt van de backend (PUBLIC_BASE_URL); lokaal kan dat http zijn.
  function safeWebUrl(value) {
    try {
      const url = new URL(String(value), window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function externalLink(url, text, className) {
    const href = safeHttpsUrl(url);
    if (!href) return el("span", { className: "muted", text: "Ongeldige link" });
    return el("a", {
      className,
      text: text || "Openen",
      attrs: { href, target: "_blank", rel: "noopener noreferrer" }
    });
  }

  // Zet een knop tijdens een API-call op "bezig", zodat dubbel klikken geen dubbele
  // producten/gebruikers of statuswissels oplevert.
  async function withBusy(button, fn) {
    if (!button) return fn();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Bezig…";
    try {
      return await fn();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function copyButton(getValue, { label = "Kopiëren", className = "btn btn-secondary" } = {}) {
    const button = el("button", { className, text: label, attrs: { type: "button" } });
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(getValue());
        button.textContent = "Gekopieerd";
        setTimeout(() => {
          if (button.isConnected) button.textContent = label;
        }, 2000);
      } catch {
        DPP.showError("Kopiëren is niet gelukt; selecteer de tekst en kopieer handmatig.");
      }
    });
    return button;
  }

  function select(name, opts, { label, value, className = "input" } = {}) {
    const node = el(
      "select",
      { className, attrs: { name, "aria-label": label || name } },
      opts.map((o) => el("option", { text: o.label, attrs: { value: o.value } }))
    );
    if (value !== undefined && value !== null) node.value = String(value);
    return node;
  }

  function loadingState(text = "Laden…") {
    return el("div", { className: "loading-state", text });
  }

  function errorCard(title, message, backHref, backLabel) {
    return el(
      "div",
      { className: "card empty-cta" },
      el("h2", { text: title }),
      el("p", { text: message }),
      backHref ? el("a", { className: "btn btn-secondary", text: backLabel || "Terug", attrs: { href: backHref } }) : null
    );
  }

  function emptyValue() {
    return el("span", { className: "empty-value", text: "—" });
  }

  // Detail-lijst (dt/dd) met "—" voor lege waarden.
  function detailList(items, className = "detail-list") {
    return el(
      "dl",
      { className },
      items.map(([label, value]) => [
        el("dt", { text: label }),
        el("dd", null, value === null || value === undefined || value === "" ? emptyValue() : value)
      ])
    );
  }

  // Voortgangsbalk; breedte via CSSOM (element.style), toegestaan onder de CSP.
  function seatsBar(active, max) {
    const bar = el("div", { className: "progress-bar" });
    const wrap = el("div", { className: "progress" }, bar);
    if (max === null || max === undefined) {
      wrap.classList.add("progress-unlimited");
      return wrap;
    }
    const ratio = max > 0 ? Math.min(1, (active || 0) / max) : 1;
    bar.style.width = `${Math.round(ratio * 100)}%`;
    if (ratio >= 1) bar.classList.add("p-danger");
    else if (ratio >= 0.8) bar.classList.add("p-warning");
    wrap.setAttribute("role", "progressbar");
    wrap.setAttribute("aria-valuemin", "0");
    wrap.setAttribute("aria-valuemax", String(max));
    wrap.setAttribute("aria-valuenow", String(active || 0));
    return wrap;
  }

  // Foutmelding met een opsomming (bijv. ontbrekende verplichte velden bij publiceren).
  // Zelfde #flash-regio als DPP.showError, zodat er nooit twee meldingen tegelijk staan.
  function showErrorList(title, items) {
    let region = document.getElementById("flash");
    if (!region) {
      region = el("div", { attrs: { id: "flash", "aria-live": "polite" } });
      (document.getElementById("content") || document.body).prepend(region);
    }
    DPP.clear(region);
    region.appendChild(
      el(
        "div",
        { className: "alert alert-error" },
        el(
          "div",
          { className: "alert-body" },
          el("div", { className: "alert-title", text: title }),
          items && items.length ? el("ul", { className: "alert-list" }, items.map((item) => el("li", { text: item }))) : null
        ),
        el("button", { className: "alert-close", text: "×", attrs: { type: "button", "aria-label": "Sluiten" }, on: { click: () => DPP.clear(region) } })
      )
    );
    region.scrollIntoView({ block: "nearest" });
  }

  // ---------- Dialogen ----------

  // Bevestigingsdialoog; resolvet met true/false.
  function confirmDialog({ title, message, confirmLabel = "Bevestigen", danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (value, close) => {
        answered = true;
        close();
        resolve(value);
      };
      const { modal } = DPP.openModal({
        title,
        body: el("p", { className: "confirm-text", text: message }),
        actions: [
          { label: "Annuleren", className: "btn btn-secondary", onClick: (close) => done(false, close) },
          { label: confirmLabel, className: danger ? "btn btn-danger" : "btn", onClick: (close) => done(true, close) }
        ]
      });
      // Sluiten via ×, Escape of klik naast de dialoog = annuleren.
      const observer = new MutationObserver(() => {
        if (!modal.isConnected) {
          observer.disconnect();
          if (!answered) resolve(false);
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }

  function clearFieldErrors(form) {
    form.querySelectorAll(".field-error").forEach((node) => node.remove());
    form.querySelectorAll(".input-invalid").forEach((node) => node.classList.remove("input-invalid"));
  }

  function markFieldError(form, name, message) {
    const control = form.elements.namedItem(name);
    if (!control || !control.closest) return;
    control.classList.add("input-invalid");
    const wrapper = control.closest(".form-field");
    if (wrapper) wrapper.appendChild(el("div", { className: "field-error", text: message }));
  }

  // Toont de melding van de API; veldfouten (details.fieldErrors van zod) komen onder het
  // betreffende veld als dat in het formulier staat.
  function showFormError(errorBox, form, error) {
    DPP.clear(errorBox);
    errorBox.appendChild(el("div", { className: "alert alert-error" }, el("span", { text: errorMessage(error) })));
    const fieldErrors = error && error.details && error.details.fieldErrors;
    if (fieldErrors && form) {
      for (const [name, messages] of Object.entries(fieldErrors)) {
        markFieldError(form, name, (messages || []).join(" "));
      }
    }
    const notPermitted = error && error.details && error.details.fields;
    if (error && error.code === "FIELD_NOT_PERMITTED" && Array.isArray(notPermitted) && form) {
      for (const name of notPermitted) markFieldError(form, name, "Geen rechten voor dit veld");
    }
  }

  // Formulier in een modal met eigen foutmelding bovenin. onSubmit(data, form, close) mag
  // een fout gooien; die wordt in de modal getoond (inclusief veldfouten van zod).
  // validate(data, form) kan vooraf client-side fouten markeren en false teruggeven.
  function formModal({ title, fields, submitLabel = "Opslaan", wide = false, intro, validate, onSubmit, readData }) {
    const errorBox = el("div", { className: "modal-error", attrs: { "aria-live": "polite" } });
    const form = el(
      "form",
      { className: "form-grid", attrs: { novalidate: true } },
      fields.filter(Boolean).map((spec) => (spec instanceof Node ? spec : DPP.field(spec)))
    );
    const body = el("div", null, intro ? (intro instanceof Node ? intro : el("p", { className: "modal-intro", text: intro })) : null, errorBox, form);
    let submitButton;
    const submit = async (close) => {
      DPP.clear(errorBox);
      clearFieldErrors(form);
      if (!form.reportValidity()) return;
      const data = readData ? readData(form) : DPP.formData(form);
      if (validate && validate(data, form) === false) return;
      await withBusy(submitButton, async () => {
        try {
          await onSubmit(data, form, close);
        } catch (error) {
          showFormError(errorBox, form, error);
        }
      });
    };
    const handle = DPP.openModal({
      title,
      wide,
      body,
      actions: [
        { label: "Annuleren", className: "btn btn-secondary", onClick: (close) => close() },
        { label: submitLabel, className: "btn", onClick: (close) => submit(close) }
      ]
    });
    submitButton = handle.modal.querySelector(".modal-actions .btn:last-child");
    // Enter in een invoerveld verstuurt het formulier via dezelfde route.
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(handle.close);
    });
    form.appendChild(el("button", { className: "hidden", attrs: { type: "submit", tabindex: "-1", "aria-hidden": "true" } }));
    return { ...handle, form, errorBox };
  }

  function checkboxField({ name, label, checked = false, help, full = true }) {
    const input = el("input", { attrs: { type: "checkbox", name } });
    input.checked = Boolean(checked);
    return el(
      "div",
      { className: `form-field${full ? " full" : ""}` },
      el("label", { className: "checkbox-label" }, input, el("span", { text: label })),
      help ? el("div", { className: "help", text: help }) : null
    );
  }

  function sectionTitle(text) {
    return el("div", { className: "section-title", text });
  }

  // Bouwt een veld uit een productveld-spec met de huidige waarde uit een API-rij.
  function productField(spec, product, { disabled = false } = {}) {
    const node = DPP.field({
      ...spec,
      value: product ? product[spec.column] ?? "" : "",
      disabled
    });
    if (spec.list) {
      const input = node.querySelector("input");
      if (input) input.setAttribute("list", spec.list);
    }
    return node;
  }

  // Leest alleen de gewijzigde velden ten opzichte van de API-rij. Een geleegd veld wordt
  // null (de backend maakt er NULL van); ongewijzigde velden gaan niet mee, zodat iemand
  // met alleen compliance-rechten nooit per ongeluk een algemeen veld meestuurt.
  function changedFields(form, specs, original) {
    const changes = {};
    for (const spec of specs) {
      const control = form.elements.namedItem(spec.name);
      if (!control || control.disabled) continue;
      const value = control.value.trim();
      const before = original && original[spec.column] != null ? String(original[spec.column]).trim() : "";
      if (value !== before) changes[spec.name] = value === "" ? null : value;
    }
    return changes;
  }

  // Categorieën als suggestielijst (<datalist>) voor het categorieveld.
  function categoryDatalist(categories) {
    return el(
      "datalist",
      { attrs: { id: "category-options" } },
      categories.map((category) => el("option", { attrs: { value: category } }))
    );
  }

  function uniqueCategories(products) {
    return [...new Set(products.map((p) => (p.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
  }

  // ---------- Actiemenu per tabelrij ----------

  // position: fixed aan <body>: een menu binnen een tabel met overflow-x zou worden afgeknipt.
  let openMenuState = null;

  function closeActionMenu({ focusAnchor = false } = {}) {
    if (!openMenuState) return;
    const { menu, anchor, cleanup } = openMenuState;
    openMenuState = null;
    cleanup();
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor.focus();
  }

  function openActionMenu(anchor, items) {
    closeActionMenu();
    const buttons = [];
    const menu = el(
      "div",
      { className: "action-menu", attrs: { role: "menu" } },
      items.map((item) => {
        if (item === "separator") return el("div", { className: "action-menu-sep", attrs: { role: "separator" } });
        const button = el("button", {
          className: `action-menu-item${item.danger ? " danger" : ""}`,
          text: item.label,
          attrs: { type: "button", role: "menuitem" },
          on: {
            click: (event) => {
              event.stopPropagation();
              closeActionMenu();
              item.onClick();
            }
          }
        });
        buttons.push(button);
        return button;
      })
    );
    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let top = rect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - menuRect.height - 4);
    const left = Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    anchor.setAttribute("aria-expanded", "true");

    const onDocClick = (event) => {
      if (!menu.contains(event.target) && event.target !== anchor) closeActionMenu();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        closeActionMenu({ focusAnchor: true });
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    };
    const onScroll = () => closeActionMenu();
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    openMenuState = {
      menu,
      anchor,
      cleanup: () => {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
      }
    };
    if (buttons[0]) buttons[0].focus();
  }

  function actionMenu(items, { label = "Acties" } = {}) {
    const visible = items.filter(Boolean);
    if (visible.filter((item) => item !== "separator").length === 0) return null;
    const button = el("button", {
      className: "btn btn-secondary btn-sm",
      text: `${label} ▾`,
      attrs: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (openMenuState && openMenuState.anchor === button) {
        closeActionMenu();
        return;
      }
      openActionMenu(button, visible);
    });
    return button;
  }

  // ---------- Producten ----------

  // Nieuw product. Compliancevelden alleen met products:compliance (een medewerker mag een
  // product aanmaken, maar geen materialen invullen). Daarna door naar de detailpagina.
  function openProductCreateModal({ categories = [] } = {}) {
    const canCompliance = DPP.can("products:compliance");
    // Sectiekoppen alleen als er twee secties zijn; de datalist als laatste, zodat de
    // eerste sectiekop :first-child blijft (geen scheidingslijn bovenaan).
    const fields = [
      canCompliance ? sectionTitle("Algemeen") : null,
      ...GENERAL_FIELDS.map((spec) => productField(spec, null)),
      canCompliance ? sectionTitle("Compliance") : null,
      ...(canCompliance ? COMPLIANCE_FIELDS.map((spec) => productField(spec, null)) : []),
      categoryDatalist(categories)
    ];
    formModal({
      title: "Nieuw product",
      submitLabel: "Product aanmaken",
      wide: true,
      intro: "Het product wordt aangemaakt als concept. Je kunt alle gegevens daarna nog aanvullen voordat je het ter review aanbiedt of publiceert.",
      fields,
      onSubmit: async (data) => {
        const product = await api.post("/api/products", data);
        window.location.href = productHref(product.id);
      }
    });
  }

  // ---------- Documenten ----------

  function validateDocument(data, form) {
    if (data.url !== undefined && !safeHttpsUrl(data.url)) {
      markFieldError(form, "url", "Alleen https-links zijn toegestaan (bijv. https://www.voorbeeld.nl/handleiding.pdf).");
      return false;
    }
    return true;
  }

  // Document toevoegen (productId vast, of een keuzelijst `products`) of bewerken (`document`).
  function openDocumentModal({ productId, products, document, onDone }) {
    const editing = Boolean(document);
    const productSelect =
      !editing && !productId
        ? {
            name: "productId",
            label: "Product",
            type: "select",
            required: true,
            full: true,
            options: [{ value: "", label: "Kies een product…" }, ...products.map((p) => ({ value: p.id, label: p.sku ? `${p.name} (${p.sku})` : p.name }))]
          }
        : null;

    const fields = [
      productSelect,
      { name: "title", label: "Titel", required: true, maxlength: 200, full: true, value: editing ? document.title : "" },
      {
        name: "type",
        label: "Type",
        type: "select",
        required: true,
        options: [{ value: "", label: "Kies een type…" }, ...DOCUMENT_TYPE_OPTIONS],
        value: editing ? document.type : ""
      },
      { name: "language", label: "Taal", maxlength: 10, placeholder: "nl, en, nl-NL", value: editing ? document.language || "" : "" },
      {
        name: "url",
        label: "Link (URL)",
        type: "url",
        required: true,
        full: true,
        maxlength: 1000,
        placeholder: "https://",
        help: "Alleen https-links. Het document zelf staat bij jullie (website, SharePoint, leverancier); DPP bewaart alleen de link.",
        value: editing ? document.url : ""
      },
      checkboxField({
        name: "isPublic",
        label: "Tonen op de publieke DPP-pagina",
        checked: editing ? Boolean(document.is_public) : false,
        help: "Uit = alleen zichtbaar voor medewerkers van je bedrijf."
      })
    ];

    formModal({
      title: editing ? "Document bewerken" : "Document toevoegen",
      submitLabel: editing ? "Opslaan" : "Toevoegen",
      fields,
      validate: validateDocument,
      readData: (form) => {
        const data = DPP.formData(form);
        // Taal leegmaken bij bewerken = null (DPP.formData maakt van "" undefined).
        if (editing && data.language === undefined && document.language) data.language = null;
        return data;
      },
      onSubmit: async (data, form, close) => {
        const body = { title: data.title, type: data.type, language: data.language, url: data.url, isPublic: Boolean(data.isPublic) };
        let result;
        if (editing) {
          // Alleen gewijzigde velden: minder audit-ruis en geen onbedoelde overschrijvingen.
          const changes = {};
          if (body.title !== document.title) changes.title = body.title;
          if (body.type !== document.type) changes.type = body.type;
          if ((body.language ?? null) !== (document.language ?? null)) changes.language = body.language ?? null;
          if (body.url !== document.url) changes.url = body.url;
          if (body.isPublic !== Boolean(document.is_public)) changes.isPublic = body.isPublic;
          if (Object.keys(changes).length === 0) {
            close();
            return;
          }
          result = await api.patch(`/api/documents/${encodeURIComponent(document.id)}`, changes);
        } else {
          const targetProduct = productId || parseIdParam(String(data.productId || ""));
          if (!targetProduct) {
            markFieldError(form, "productId", "Kies een product");
            return;
          }
          result = await api.post(`/api/products/${encodeURIComponent(targetProduct)}/documents`, body);
        }
        close();
        DPP.showSuccess(editing ? "Document opgeslagen." : "Document toegevoegd.");
        if (onDone) onDone(result);
      }
    });
  }

  async function deleteDocument(document, onDone) {
    const ok = await confirmDialog({
      title: "Document verwijderen",
      message: `"${document.title}" wordt verwijderd${document.is_public ? " en verdwijnt van de publieke DPP-pagina" : ""}. Het bestand zelf blijft staan waar het staat. Doorgaan?`,
      confirmLabel: "Verwijderen",
      danger: true
    });
    if (!ok) return;
    try {
      await api.delete(`/api/documents/${encodeURIComponent(document.id)}`);
      DPP.showSuccess("Document verwijderd.");
      if (onDone) onDone();
    } catch (error) {
      showApiError(error);
    }
  }

  function visibilityBadge(isPublic) {
    return isPublic ? el("span", { className: "badge badge-public", text: "Publiek" }) : el("span", { className: "badge badge-private", text: "Intern" });
  }

  // ---------- QR ----------

  function qrUrls(id) {
    const base = `/api/products/${encodeURIComponent(id)}`;
    return {
      preview: `${base}/qr.svg`,
      svg: `${base}/qr.svg?download=1`,
      png: `${base}/qr.png?download=1&size=1024`
    };
  }

  // Downloadlinks als <a>: de browser volgt de Content-Disposition van de backend, die ook
  // de qr_generate-audit schrijft. Alleen ?download=1 telt als download (voorvertoning niet).
  function qrDownloadLinks(id, { small = false } = {}) {
    const urls = qrUrls(id);
    const cls = `btn btn-secondary${small ? " btn-sm" : ""}`;
    return [
      el("a", { className: cls, text: "Download PNG", attrs: { href: urls.png, download: "", title: "1024 × 1024 px, geschikt voor drukwerk" } }),
      el("a", { className: cls, text: "Download SVG", attrs: { href: urls.svg, download: "", title: "Vectorbestand, schaalbaar zonder kwaliteitsverlies" } })
    ];
  }

  function qrPreview(id, name) {
    return el("img", { className: "qr-preview", attrs: { src: qrUrls(id).preview, alt: `QR-code voor ${name}`, width: 200, height: 200, loading: "lazy" } });
  }

  // stacked: invoerveld boven de knoppen (smalle kaarten op de QR-pagina).
  function publicUrlBox(url, { small = false, stacked = false } = {}) {
    const href = safeWebUrl(url);
    const btnClass = `btn btn-secondary${small ? " btn-sm" : ""}`;
    const input = el("input", { className: "input", attrs: { type: "text", readonly: true, value: url || "", "aria-label": "Publieke URL" } });
    input.addEventListener("focus", () => input.select());
    const buttons = [
      copyButton(() => url, { className: btnClass, label: stacked ? "Kopieer URL" : "Kopiëren" }),
      href ? el("a", { className: btnClass, text: "Openen ↗", attrs: { href, target: "_blank", rel: "noopener noreferrer" } }) : null
    ];
    if (stacked) {
      return el("div", { className: "url-box stacked" }, input, el("div", { className: "url-box-buttons" }, buttons));
    }
    return el("div", { className: "url-box" }, input, buttons);
  }

  // ---------- Audit ----------

  function describeAudit(item) {
    const meta = item.metadata || {};
    if (item.action === "role_change" && meta.from && meta.to) return `${DPP.roleLabel(meta.from)} → ${DPP.roleLabel(meta.to)}`;
    if (meta.from && meta.to) return `${DPP.statusLabel(meta.from)} → ${DPP.statusLabel(meta.to)}`;
    if (Array.isArray(meta.fields) && meta.fields.length) return meta.fields.map(fieldLabel).join(", ");
    if (meta.type && item.entity_type === "Document") return documentTypeLabel(meta.type);
    if (meta.format) return String(meta.format).toUpperCase();
    return "";
  }

  function actorLabel(item) {
    if (item.actor_type === "platform") return "Platformbeheer";
    return item.actor_email || "—";
  }

  DPP.app = {
    PRODUCT_STATUS_OPTIONS,
    DOCUMENT_TYPE_LABELS,
    DOCUMENT_TYPE_OPTIONS,
    ASSIGNABLE_ROLES,
    ROLE_DESCRIPTIONS,
    GENERAL_FIELDS,
    COMPLIANCE_FIELDS,
    COMPLIANCE_FIELD_NAMES,
    NOTES_FIELD,
    errorMessage,
    showApiError,
    showErrorList,
    actionLabel,
    entityLabel,
    documentTypeLabel,
    fieldLabel,
    debounce,
    parseIdParam,
    productHref,
    safeHttpsUrl,
    safeWebUrl,
    externalLink,
    withBusy,
    copyButton,
    select,
    loadingState,
    errorCard,
    detailList,
    seatsBar,
    confirmDialog,
    formModal,
    showFormError,
    clearFieldErrors,
    markFieldError,
    checkboxField,
    sectionTitle,
    productField,
    changedFields,
    categoryDatalist,
    uniqueCategories,
    actionMenu,
    closeActionMenu,
    openProductCreateModal,
    openDocumentModal,
    deleteDocument,
    visibilityBadge,
    qrUrls,
    qrDownloadLinks,
    qrPreview,
    publicUrlBox,
    describeAudit,
    actorLabel
  };
})();
