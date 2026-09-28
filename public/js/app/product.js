// Productdetail: statusflow, publicatie-checklist en tabbladen per soort gegevens.
// Welke knoppen/velden bewerkbaar zijn, volgt de permissies uit /api/auth/me; de backend
// controleert elke transitie en elk veld opnieuw (403 FIELD_NOT_PERMITTED / TRANSITION_NOT_PERMITTED).
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  // Spiegel van de transitietabel in src/services/productWorkflow.js (§4). Alleen voor het
  // tonen van knoppen; de backend beslist. Volgorde = volgorde in de paginakop.
  const WORKFLOW = [
    {
      to: "archived",
      from: ["draft", "review", "published"],
      permissions: ["products:archive"],
      label: "Archiveren",
      className: "btn btn-secondary btn-danger-outline",
      confirm: (p) => ({
        title: "Product archiveren",
        message:
          p.status === "published"
            ? "Het product wordt gearchiveerd en de publieke DPP-pagina is daarna niet meer bereikbaar. Gearchiveerde producten zijn alleen-lezen. Doorgaan?"
            : "Gearchiveerde producten zijn alleen-lezen en tellen niet mee in de overzichten. Je kunt het later herstellen als concept. Doorgaan?",
        confirmLabel: "Archiveren",
        danger: true
      }),
      success: "Product gearchiveerd."
    },
    {
      to: "draft",
      from: ["review"],
      permissions: ["products:submit_review", "products:publish"],
      label: "Terugsturen naar concept",
      className: "btn btn-secondary",
      success: "Product teruggestuurd naar concept."
    },
    {
      to: "review",
      from: ["draft"],
      permissions: ["products:submit_review"],
      label: "Indienen voor review",
      className: "btn btn-secondary",
      success: "Product ingediend voor review."
    },
    {
      to: "draft",
      from: ["published"],
      permissions: ["products:publish"],
      label: "Depubliceren",
      className: "btn btn-secondary",
      confirm: () => ({
        title: "Product depubliceren",
        message:
          "De publieke DPP-pagina geeft daarna 'niet gevonden' en het product gaat terug naar concept. De QR-code blijft dezelfde: na opnieuw publiceren werkt hij weer. Doorgaan?",
        confirmLabel: "Depubliceren"
      }),
      success: "Product gedepubliceerd. De QR-code werkt weer zodra je het opnieuw publiceert."
    },
    {
      to: "published",
      from: ["draft", "review"],
      permissions: ["products:publish"],
      label: "Publiceren",
      className: "btn",
      confirm: (p, checklist) => {
        const openRecommended = (checklist ? checklist.items : []).filter((i) => i.level === "recommended" && !i.ok).map((i) => i.label);
        return {
          title: "Product publiceren",
          message: `Het digitale productpaspoort van "${p.name}" wordt publiek zichtbaar via de publieke URL en de QR-code.${
            openRecommended.length ? ` Aanbevolen maar nog niet ingevuld: ${openRecommended.join(", ")}.` : ""
          } Doorgaan?`,
          confirmLabel: "Publiceren"
        };
      },
      success: "Product gepubliceerd. De publieke pagina en QR-code zijn nu actief."
    },
    {
      to: "draft",
      from: ["archived"],
      permissions: ["products:archive"],
      label: "Herstellen",
      className: "btn",
      success: "Product hersteld als concept."
    }
  ];

  const EDIT_PERMISSIONS = ["products:update", "products:compliance", "documents:manage", "products:submit_review", "products:publish", "products:archive"];

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");
    const id = A.parseIdParam(DPP.getQueryParam("id"));

    if (!id) {
      content.appendChild(A.errorCard("Product niet gevonden", "Dit product bestaat niet of je hebt er geen toegang toe.", "/app/products.html", "Naar producten"));
      return;
    }

    const base = `/api/products/${encodeURIComponent(id)}`;
    const state = { product: null, checklist: null, documents: [], activeTab: null, flagged: new Set(), dirty: new Set() };
    const readOnlyUser = !EDIT_PERMISSIONS.some((permission) => DPP.can(permission));

    const slots = {
      header: el("div"),
      notice: el("div"),
      tabs: el("div", { className: "tabs", attrs: { role: "tablist" } }),
      panels: el("div"),
      aside: el("aside", { className: "product-aside" })
    };
    const panelNodes = new Map();

    content.appendChild(A.loadingState());

    window.addEventListener("beforeunload", (event) => {
      if (state.dirty.size > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    function isArchived() {
      return state.product.status === "archived";
    }

    function setDirty(key, dirty) {
      if (dirty) state.dirty.add(key);
      else state.dirty.delete(key);
    }

    function tabDefinitions() {
      const p = state.product;
      return [
        { key: "algemeen", label: "Algemeen", render: renderGeneral },
        { key: "compliance", label: "Compliance", render: renderCompliance },
        { key: "documenten", label: "Documenten", count: state.documents.length, render: renderDocuments },
        p.status === "published" ? { key: "qr", label: "QR & publicatie", render: renderQr } : null,
        { key: "notities", label: "Interne notities", render: renderNotes }
      ].filter(Boolean);
    }

    // ---------- Kop + statusknoppen ----------

    function allowedTransitions() {
      const p = state.product;
      return WORKFLOW.filter((t) => t.from.includes(p.status) && t.permissions.some((permission) => DPP.can(permission)));
    }

    function renderHeader() {
      const p = state.product;
      const transitions = allowedTransitions();
      const hasPublish = transitions.some((t) => t.to === "published");
      const buttons = transitions.map((t) => {
        // Zonder publiceerknop is "Indienen voor review" de hoofdactie.
        const className = t.to === "review" && !hasPublish ? "btn" : t.className;
        const button = el("button", { className, text: t.label, attrs: { type: "button" } });
        button.addEventListener("click", () => changeStatus(t, button));
        return button;
      });
      const publicHref = p.public_url ? A.safeWebUrl(p.public_url) : null;
      if (publicHref) {
        buttons.unshift(el("a", { className: "btn btn-ghost", text: "Publieke pagina ↗", attrs: { href: publicHref, target: "_blank", rel: "noopener noreferrer" } }));
      }

      const subtitle = [p.sku ? `SKU ${p.sku}` : null, p.category, `Bijgewerkt ${DPP.formatDateTime(p.updated_at || p.created_at)}`].filter(Boolean).join(" · ");

      DPP.clear(slots.header);
      slots.header.appendChild(el("a", { className: "back-link", text: "← Alle producten", attrs: { href: "/app/products.html" } }));
      slots.header.appendChild(
        el(
          "div",
          { className: "page-header" },
          el(
            "div",
            null,
            el("div", { className: "title-row" }, el("h1", { text: p.name }), el("span", { className: `badge badge-lg badge-${p.status}`, text: DPP.statusLabel(p.status) })),
            el("p", { className: "subtitle", text: subtitle })
          ),
          buttons.length ? el("div", { className: "page-actions" }, buttons) : null
        )
      );
      document.title = `${p.name} — DPP Platform`;

      DPP.clear(slots.notice);
      if (isArchived()) {
        slots.notice.appendChild(
          el("div", { className: "alert alert-info" }, el("span", { text: "Dit product is gearchiveerd en alleen-lezen. Herstel het als concept om het weer te bewerken." }))
        );
      } else if (readOnlyUser) {
        slots.notice.appendChild(el("div", { className: "alert alert-info" }, el("span", { text: "Je hebt leesrechten: je kunt dit product bekijken, maar niet wijzigen." })));
      } else if (p.status === "review" && DPP.can("products:publish")) {
        slots.notice.appendChild(
          el("div", { className: "alert alert-warning" }, el("span", { text: "Dit product wacht op review. Controleer de gegevens en publiceer het, of stuur het terug naar concept." }))
        );
      }
    }

    // Toont welke verplichte velden ontbreken en markeert ze in de checklist.
    function showPublishMissing(missing) {
      state.flagged = new Set(missing);
      renderAside();
      A.showErrorList("Publiceren kan nog niet: deze verplichte velden ontbreken.", missing.map(A.fieldLabel));
    }

    async function changeStatus(transition, button) {
      const p = state.product;
      // Publiceren met ontbrekende verplichte velden faalt altijd (422); toon dan direct wat
      // ontbreekt in plaats van een bevestiging die belooft dat het paspoort publiek wordt.
      // Dit staat vóór de vraag over niet-opgeslagen wijzigingen, zodat de gebruiker niet eerst
      // "Doorgaan zonder opslaan?" krijgt en daarna hoort dat publiceren niet kan.
      // De backend blijft beslissen; bij een verouderde checklist vangt de 422 hieronder het op.
      if (transition.to === "published") {
        // Eerst verversen: een collega kan de ontbrekende velden intussen hebben ingevuld (of
        // geleegd). Lukt dat niet, dan werken we met de bekende checklist verder.
        await A.withBusy(button, async () => {
          try {
            state.checklist = await api.get(`${base}/checklist`);
            renderAside();
          } catch (error) {
            // Bewust stil: de statuswijziging zelf toont straks een eventuele fout.
          }
        });
      }
      if (transition.to === "published" && state.checklist && state.checklist.ready === false) {
        const missing = (Array.isArray(state.checklist.items) ? state.checklist.items : [])
          .filter((i) => i.level === "required" && !i.ok)
          .map((i) => String(i.field));
        if (missing.length) {
          showPublishMissing(missing);
          return;
        }
      }
      if (state.dirty.size > 0) {
        const proceed = await A.confirmDialog({
          title: "Niet-opgeslagen wijzigingen",
          message: "Je hebt wijzigingen die nog niet zijn opgeslagen. Die gaan verloren als je nu de status wijzigt. Doorgaan zonder opslaan?",
          confirmLabel: "Doorgaan zonder opslaan",
          danger: true
        });
        if (!proceed) return;
      }
      if (transition.confirm) {
        const ok = await A.confirmDialog(transition.confirm(p, state.checklist));
        if (!ok) return;
      }
      await A.withBusy(button, async () => {
        try {
          state.product = await api.post(`${base}/status`, { status: transition.to });
          state.checklist = await api.get(`${base}/checklist`);
          state.flagged.clear();
          state.dirty.clear();
          if (transition.to === "published") state.activeTab = "qr";
          else if (state.activeTab === "qr") state.activeTab = "algemeen";
          renderAll();
          DPP.showSuccess(transition.success);
        } catch (error) {
          if (error.code === "PUBLISH_REQUIREMENTS_MISSING") {
            // Vangnet als de lokale checklist verouderd was (bijv. een collega leegde een veld).
            showPublishMissing((error.details && Array.isArray(error.details.missing) ? error.details.missing : []).map(String));
            return;
          }
          A.showApiError(error);
          if (error.code === "INVALID_TRANSITION") await reload();
        }
      });
    }

    // ---------- Zijkolom: checklist + gegevens ----------

    function tabForField(field) {
      if (field === "publicDocuments") return "documenten";
      if (A.COMPLIANCE_FIELD_NAMES.includes(field)) return "compliance";
      return "algemeen";
    }

    function goToField(field) {
      activateTab(tabForField(field));
      const panel = panelNodes.get(state.activeTab);
      const control = panel && panel.querySelector(`[name="${CSS.escape(field)}"]`);
      if (control && !control.disabled) control.focus();
      else if (panel) panel.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function checklistItem(item) {
      const flagged = state.flagged.has(item.field);
      const kind = item.ok ? "ok" : item.level === "required" ? "missing" : "warn";
      const mark = item.ok ? "✓" : item.level === "required" ? "✗" : "!";
      const label = item.ok
        ? el("span", { className: "check-label", text: item.label })
        : el("span", { className: "check-label" }, el("button", { className: "check-link", text: item.label, attrs: { type: "button" }, on: { click: () => goToField(item.field) } }));
      return el(
        "li",
        { className: `check-item ${kind}${flagged ? " flagged" : ""}` },
        el("span", { className: "check-mark", text: mark, attrs: { "aria-hidden": "true" } }),
        label,
        item.ok ? null : el("span", { className: "check-tag", text: item.level === "required" ? "Verplicht" : "Aanbevolen" })
      );
    }

    function renderChecklistCard() {
      const checklist = state.checklist || { ready: false, items: [] };
      const required = checklist.items.filter((i) => i.level === "required");
      const recommended = checklist.items.filter((i) => i.level === "recommended");
      const missingCount = required.filter((i) => !i.ok).length;
      const summary = checklist.ready
        ? el("div", { className: "checklist-summary ready" }, el("span", { text: "✓" }), el("span", { text: "Voldoet aan de publicatie-eisen" }))
        : el(
            "div",
            { className: "checklist-summary not-ready" },
            el("span", { text: "!" }),
            el("span", { text: `${missingCount} verplicht${missingCount === 1 ? " veld ontbreekt" : "e velden ontbreken"}` })
          );
      return el(
        "div",
        { className: "card" },
        el("h2", { text: "Publicatie-checklist" }),
        summary,
        el("div", { className: "checklist-group", text: "Verplicht voor publicatie" }),
        el("ul", { className: "check-list" }, required.map(checklistItem)),
        el("div", { className: "checklist-group", text: "Aanbevolen" }),
        el("ul", { className: "check-list" }, recommended.map(checklistItem))
      );
    }

    function byline(date, email, withTime) {
      const when = withTime ? DPP.formatDateTime(date) : DPP.formatDate(date);
      return email ? el("div", { className: "cell-stack" }, el("span", { text: when }), el("span", { className: "muted", text: email })) : when;
    }

    function renderMetaCard() {
      const p = state.product;
      const publicHref = p.public_url ? A.safeWebUrl(p.public_url) : null;
      return el(
        "div",
        { className: "card" },
        el("h2", { text: "Gegevens" }),
        A.detailList(
          [
            ["Status", DPP.statusBadge(p.status)],
            ["Aangemaakt", byline(p.created_at, p.created_by_email, false)],
            ["Gewijzigd", byline(p.updated_at, p.updated_by_email, true)],
            ["Gepubliceerd", p.published_at ? DPP.formatDate(p.published_at) : null],
            ["Publieke pagina", publicHref ? el("a", { text: "Openen ↗", attrs: { href: publicHref, target: "_blank", rel: "noopener noreferrer" } }) : null]
          ],
          "detail-list detail-compact"
        )
      );
    }

    function renderAside() {
      DPP.clear(slots.aside);
      slots.aside.appendChild(renderChecklistCard());
      slots.aside.appendChild(renderMetaCard());
    }

    // ---------- Tabbladen ----------

    function renderTabs() {
      const tabs = tabDefinitions();
      if (!tabs.some((t) => t.key === state.activeTab)) state.activeTab = tabs[0].key;
      DPP.clear(slots.tabs);
      for (const t of tabs) {
        const active = t.key === state.activeTab;
        slots.tabs.appendChild(
          el(
            "button",
            {
              className: `tab${active ? " active" : ""}`,
              attrs: { type: "button", role: "tab", "aria-selected": active ? "true" : "false", "data-tab": t.key },
              on: { click: () => activateTab(t.key) }
            },
            t.label,
            t.count !== undefined ? el("span", { className: "tab-count", text: t.count }) : null
          )
        );
      }
    }

    function activateTab(key) {
      state.activeTab = key;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${key}`);
      for (const button of slots.tabs.querySelectorAll(".tab")) {
        const active = button.dataset.tab === key;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const [panelKey, node] of panelNodes) node.classList.toggle("hidden", panelKey !== key);
    }

    function renderPanel(key) {
      const def = tabDefinitions().find((t) => t.key === key);
      if (!def) return;
      const node = def.render();
      node.setAttribute("role", "tabpanel");
      node.classList.toggle("hidden", key !== state.activeTab);
      const existing = panelNodes.get(key);
      if (existing && existing.isConnected) existing.replaceWith(node);
      else slots.panels.appendChild(node);
      panelNodes.set(key, node);
    }

    function renderAll() {
      DPP.clear(content);
      const flash = document.getElementById("flash");
      if (flash) content.appendChild(flash);
      content.appendChild(slots.header);
      content.appendChild(slots.notice);
      content.appendChild(el("div", { className: "product-layout" }, el("div", { className: "product-main" }, slots.tabs, slots.panels), slots.aside));
      renderHeader();
      renderTabs();
      DPP.clear(slots.panels);
      panelNodes.clear();
      for (const t of tabDefinitions()) renderPanel(t.key);
      renderAside();
    }

    // Formulier voor een groep productvelden. Alleen gewijzigde velden gaan mee in de PATCH.
    function fieldsPanel({ key, title, description, specs, editable, readonlyReason, extra }) {
      const p = state.product;
      const card = el(
        "div",
        { className: "card" },
        el("div", { className: "panel-header" }, el("div", null, el("h2", { text: title }), description ? el("p", { text: description }) : null))
      );

      if (!editable) {
        if (readonlyReason && !readOnlyUser && !isArchived()) card.appendChild(el("div", { className: "readonly-note", text: readonlyReason }));
        card.appendChild(A.detailList(specs.map((spec) => [spec.label, p[spec.column] ?? null])));
        return card;
      }

      const errorBox = el("div", { className: "modal-error", attrs: { "aria-live": "polite" } });
      const form = el("form", { className: "form-grid panel-form", attrs: { novalidate: true } }, extra || null, specs.map((spec) => A.productField(spec, p)));
      const dirtyHint = el("span", { className: "dirty-hint" });
      const resetButton = el("button", { className: "btn btn-secondary", text: "Wijzigingen ongedaan maken", attrs: { type: "button", disabled: true } });
      const saveButton = el("button", { className: "btn", text: "Opslaan", attrs: { type: "submit", disabled: true } });
      form.appendChild(el("div", { className: "form-actions full" }, dirtyHint, resetButton, saveButton));

      const updateDirty = () => {
        const dirty = Object.keys(A.changedFields(form, specs, state.product)).length > 0;
        setDirty(key, dirty);
        saveButton.disabled = !dirty;
        resetButton.disabled = !dirty;
        dirtyHint.textContent = dirty ? "Niet-opgeslagen wijzigingen" : "";
      };
      form.addEventListener("input", updateDirty);

      resetButton.addEventListener("click", () => {
        setDirty(key, false);
        renderPanel(key);
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        DPP.clear(errorBox);
        A.clearFieldErrors(form);
        if (!form.reportValidity()) return;
        const changes = A.changedFields(form, specs, state.product);
        if (Object.keys(changes).length === 0) return;
        await A.withBusy(saveButton, async () => {
          try {
            state.product = await api.patch(base, changes);
            state.checklist = await api.get(`${base}/checklist`);
            for (const field of Object.keys(changes)) state.flagged.delete(field);
            setDirty(key, false);
            renderHeader();
            renderPanel(key);
            renderAside();
            DPP.showSuccess("Wijzigingen opgeslagen.");
          } catch (error) {
            A.showFormError(errorBox, form, error);
            if (error.code === "PRODUCT_ARCHIVED") await reload();
          }
        });
      });

      card.appendChild(errorBox);
      card.appendChild(form);
      return card;
    }

    function renderGeneral() {
      return fieldsPanel({
        key: "algemeen",
        title: "Algemene gegevens",
        description: "Identificatie van het product zoals die op de publieke DPP-pagina staat.",
        specs: A.GENERAL_FIELDS,
        editable: DPP.can("products:update") && !isArchived(),
        readonlyReason: "Je kunt de algemene productgegevens bekijken, maar niet wijzigen.",
        extra: A.categoryDatalist(state.categories || [])
      });
    }

    function renderCompliance() {
      return fieldsPanel({
        key: "compliance",
        title: "Compliance en duurzaamheid",
        description: "Materialen, herkomst, compliance, recycling en reparatie. Materialen en land van herkomst zijn verplicht voor publicatie.",
        specs: A.COMPLIANCE_FIELDS,
        editable: DPP.can("products:compliance") && !isArchived(),
        readonlyReason: "Compliancevelden worden bijgehouden door een Compliance Manager, Product Manager of Company Admin."
      });
    }

    function renderNotes() {
      return fieldsPanel({
        key: "notities",
        title: "Interne notities",
        description: "Alleen zichtbaar voor medewerkers van je bedrijf. Komt nooit op de publieke DPP-pagina.",
        specs: [A.NOTES_FIELD],
        editable: DPP.can("products:update") && !isArchived(),
        readonlyReason: "Je kunt de interne notities lezen, maar niet wijzigen."
      });
    }

    async function reloadDocuments() {
      try {
        const [documents, checklist] = await Promise.all([api.get(`${base}/documents`), api.get(`${base}/checklist`)]);
        state.documents = documents;
        state.checklist = checklist;
        renderTabs();
        activateTab(state.activeTab);
        renderPanel("documenten");
        renderAside();
      } catch (error) {
        A.showApiError(error);
      }
    }

    function renderDocuments() {
      const canManage = DPP.can("documents:manage") && !isArchived();
      const addButton = canManage
        ? el("button", {
            className: "btn",
            text: "Document toevoegen",
            attrs: { type: "button" },
            on: { click: () => A.openDocumentModal({ productId: id, onDone: reloadDocuments }) }
          })
        : null;
      // docs-card is een CSS-container: de tabel past zich aan de breedte van deze kaart aan
      // (zie app.css), niet aan het venster.
      const card = el(
        "div",
        { className: "card docs-card" },
        el(
          "div",
          { className: "panel-header" },
          el(
            "div",
            null,
            el("h2", { text: "Documenten" }),
            el("p", { text: "Handleidingen, certificaten en verklaringen als https-link. Alleen publieke documenten verschijnen op de DPP-pagina." })
          ),
          addButton
        )
      );
      const holder = el("div");
      DPP.renderTable(holder, {
        // Geen aparte datumkolom: naast de checklist is dit paneel smal (±770px op 1440px) en
        // duwde een extra nowrap-kolom 'Acties' buiten de kaart. Als gewone (wrapbare) regel in
        // de titelcel verhoogt de datum de minimale tabelbreedte niet. Om dezelfde reden schuift
        // het type bij een smalle kaart als regel in de titelcel (hide-narrow/show-narrow).
        columns: [
          {
            label: "Titel",
            render: (d) =>
              el(
                "div",
                { className: "cell-stack" },
                el("span", { className: "cell-strong", text: d.title }),
                el("span", { className: "muted show-narrow", text: A.documentTypeLabel(d.type) }),
                el("span", {
                  className: "muted",
                  // Harde spaties: de datum zelf ("28 sep 2026") breekt niet, de regel eromheen wel.
                  text: [d.language ? `Taal: ${d.language}` : null, `Toegevoegd ${DPP.formatDate(d.created_at).replace(/ /g, "\u00a0")}`]
                    .filter(Boolean)
                    .join(" · ")
                })
              )
          },
          { label: "Type", className: "hide-narrow", render: (d) => A.documentTypeLabel(d.type) },
          { label: "Zichtbaarheid", render: (d) => A.visibilityBadge(d.is_public) },
          {
            label: "",
            className: "col-actions",
            render: (d) =>
              el(
                "div",
                { className: "row-actions" },
                A.externalLink(d.url, "Openen ↗", "btn btn-ghost btn-sm"),
                canManage
                  ? A.actionMenu([
                      { label: "Bewerken", onClick: () => A.openDocumentModal({ document: d, onDone: reloadDocuments }) },
                      { label: "Verwijderen", danger: true, onClick: () => A.deleteDocument(d, reloadDocuments) }
                    ])
                  : null
              )
          }
        ],
        rows: state.documents,
        empty: canManage ? "Nog geen documenten. Voeg bijvoorbeeld een handleiding of conformiteitsverklaring toe." : "Er zijn nog geen documenten toegevoegd."
      });
      card.appendChild(holder);
      return card;
    }

    function renderQr() {
      const p = state.product;
      const canQr = DPP.can("qr:download");
      const left = canQr
        ? A.qrPreview(p.id, p.name)
        : el("div", { className: "readonly-note", text: "Je hebt geen rechten om QR-codes te bekijken of te downloaden." });

      const right = el(
        "div",
        null,
        el("h3", { text: "Publieke URL" }),
        p.public_url ? A.publicUrlBox(p.public_url) : el("p", { className: "muted", text: "Nog geen publieke URL." }),
        canQr ? el("h3", { className: "mt-24", text: "Downloaden" }) : null,
        canQr ? el("div", { className: "qr-downloads" }, A.qrDownloadLinks(p.id)) : null,
        canQr ? el("p", { className: "help-text mt-8", text: "PNG (1024 × 1024 px) voor etiketten en drukwerk; SVG voor vormgeving en grote formaten." }) : null,
        el("h3", { className: "mt-24", text: "Gebruik" }),
        el("p", {
          className: "help-text",
          text: "Plaats de QR-code op het product, de verpakking of het label (minimaal 2 × 2 cm, met witruimte eromheen). De code verwijst naar de publieke URL en blijft geldig, ook als je het product tijdelijk depubliceert en later opnieuw publiceert."
        })
      );

      return el(
        "div",
        { className: "card" },
        el(
          "div",
          { className: "panel-header" },
          el("div", null, el("h2", { text: "QR-code en publicatie" }), el("p", { text: p.published_at ? `Voor het eerst gepubliceerd op ${DPP.formatDate(p.published_at)}.` : "Gepubliceerd." }))
        ),
        el("div", { className: "qr-panel" }, left, right)
      );
    }

    // ---------- Laden ----------

    async function reload() {
      try {
        const [product, checklist, documents] = await Promise.all([api.get(base), api.get(`${base}/checklist`), api.get(`${base}/documents`)]);
        state.product = product;
        state.checklist = checklist;
        state.documents = documents;
        state.dirty.clear();
        renderAll();
      } catch (error) {
        DPP.clear(content);
        if (error.status === 404) {
          content.appendChild(A.errorCard("Product niet gevonden", "Dit product bestaat niet of je hebt er geen toegang toe.", "/app/products.html", "Naar producten"));
        } else {
          content.appendChild(A.errorCard("Product kon niet worden geladen", A.errorMessage(error), "/app/products.html", "Naar producten"));
        }
      }
    }

    const hashTab = window.location.hash.replace(/^#/, "");
    state.activeTab = /^[a-z]+$/.test(hashTab) ? hashTab : "algemeen";

    // Categorie-suggesties zijn gemak; zonder lijst werkt het formulier gewoon.
    if (DPP.can("products:update")) {
      api
        .get("/api/products")
        .then((rows) => {
          state.categories = A.uniqueCategories(rows);
          const list = document.getElementById("category-options");
          if (list) list.replaceWith(A.categoryDatalist(state.categories));
        })
        .catch(() => {});
    }

    await reload();
  });
})();
