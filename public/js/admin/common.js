// Gedeelde bouwstenen voor de System Owner-console (/admin). Hangt onder DPP.admin.
// Alle tekst via textContent (DPP.el); gevoelige waarden (activatielinks, tijdelijke
// wachtwoorden) gaan alleen naar DPP.showSecretOnce en worden nergens bewaard.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;

  const COMPANY_STATUS_OPTIONS = [
    { value: "active", label: "Actief" },
    { value: "suspended", label: "Gedeactiveerd" },
    { value: "archived", label: "Gearchiveerd" }
  ];

  const USER_STATUS_OPTIONS = [
    { value: "active", label: "Actief" },
    { value: "inactive", label: "Inactief" },
    { value: "blocked", label: "Geblokkeerd" }
  ];

  const INVITE_STATUS_OPTIONS = [
    { value: "pending", label: "Openstaand" },
    { value: "accepted", label: "Geaccepteerd" },
    { value: "expired", label: "Verlopen" },
    { value: "revoked", label: "Ingetrokken" }
  ];

  const PRODUCT_STATUS_OPTIONS = [
    { value: "draft", label: "Concept" },
    { value: "review", label: "In review" },
    { value: "published", label: "Gepubliceerd" },
    { value: "archived", label: "Gearchiveerd" }
  ];

  // Company-rollen (system_owner hoort bij geen company en loopt niet via deze schermen).
  const COMPANY_ROLE_OPTIONS = ["company_admin", "product_manager", "compliance_manager", "company_user", "viewer"].map(
    (role) => ({ value: role, label: DPP.roleLabel(role) })
  );

  // Vaste lijst uit docs/architecture-roles.md §7. Onbekende acties tonen we als ruwe code
  // (komt uit onze eigen database, nooit uit de URL).
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
    seat_limit_change: "Seat-limiet gewijzigd",
    archive: "Gearchiveerd",
    submit_review: "Ter review aangeboden",
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
    document_delete: "Document verwijderd",
    delete: "Verwijderd"
  };

  const ENTITY_LABELS = {
    Company: "Bedrijf",
    User: "Gebruiker",
    Plan: "Plan",
    CompanyInvitation: "Uitnodiging",
    Product: "Product",
    Document: "Document"
  };

  function actionLabel(action) {
    return AUDIT_ACTION_LABELS[action] || action || "—";
  }

  function entityLabel(type) {
    return ENTITY_LABELS[type] || type || "—";
  }

  function options(list, allLabel) {
    return [{ value: "", label: allLabel }, ...list];
  }

  function select(name, opts, { label, value } = {}) {
    const node = el(
      "select",
      { className: "input", attrs: { name, "aria-label": label || name } },
      opts.map((o) => el("option", { text: o.label, attrs: { value: o.value } }))
    );
    if (value !== undefined && value !== null) node.value = String(value);
    return node;
  }

  function debounce(fn, ms = 200) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Zet een knop tijdens een API-call op "bezig", zodat dubbel klikken geen dubbele
  // bedrijven/uitnodigingen oplevert.
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

  // Formulier in een modal met eigen foutmelding bovenin. onSubmit(data, form) mag een
  // fout gooien; die wordt in de modal getoond (inclusief veldfouten van zod).
  function formModal({ title, fields, submitLabel = "Opslaan", wide = false, intro, onSubmit }) {
    const errorBox = el("div", { className: "modal-error", attrs: { "aria-live": "polite" } });
    const form = el(
      "form",
      { className: "form-grid", attrs: { novalidate: true } },
      fields.map((spec) => (spec instanceof Node ? spec : DPP.field(spec)))
    );
    const body = el("div", null, intro ? el("p", { className: "modal-intro", text: intro }) : null, errorBox, form);
    let submitButton;
    const submit = async (close) => {
      DPP.clear(errorBox);
      clearFieldErrors(form);
      if (!form.reportValidity()) return;
      await withBusy(submitButton, async () => {
        try {
          await onSubmit(DPP.formData(form), form, close);
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

  function clearFieldErrors(form) {
    form.querySelectorAll(".field-error").forEach((node) => node.remove());
    form.querySelectorAll(".input-invalid").forEach((node) => node.classList.remove("input-invalid"));
  }

  // Toont de melding van de API; veldfouten (details.fieldErrors van zod) komen onder het
  // betreffende veld als dat in het formulier staat.
  function showFormError(errorBox, form, error) {
    DPP.clear(errorBox);
    errorBox.appendChild(el("div", { className: "alert alert-error" }, el("span", { text: error.message || "Er ging iets mis" })));
    const fieldErrors = error && error.details && error.details.fieldErrors;
    if (!fieldErrors || !form) return;
    for (const [name, messages] of Object.entries(fieldErrors)) {
      const control = form.elements.namedItem(name);
      if (!control || !control.closest) continue;
      control.classList.add("input-invalid");
      const wrapper = control.closest(".form-field");
      if (wrapper) wrapper.appendChild(el("div", { className: "field-error", text: (messages || []).join(" ") }));
    }
  }

  // Tekstvelden: "" betekent leegmaken (backend maakt er NULL van); getallen/plan: leeg = null.
  function textValue(form, name) {
    const control = form.elements.namedItem(name);
    return control ? control.value.trim() : undefined;
  }

  function numberOrNull(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // ---------- Seats ----------

  function seatsText(active, max) {
    if (max === null || max === undefined) return `${DPP.formatNumber(active || 0)} / onbeperkt`;
    return `${DPP.formatNumber(active || 0)} / ${DPP.formatNumber(max)}`;
  }

  // Voortgangsbalk; breedte via CSSOM (element.style), toegestaan onder de CSP.
  function seatsBar(active, max, { compact = false } = {}) {
    const bar = el("div", { className: "progress-bar" });
    const wrap = el("div", { className: `progress${compact ? " progress-compact" : ""}` }, bar);
    if (max === null || max === undefined) {
      wrap.classList.add("progress-unlimited");
      return wrap;
    }
    const ratio = max > 0 ? Math.min(1, (active || 0) / max) : 1;
    bar.style.width = `${Math.round(ratio * 100)}%`;
    if (ratio >= 1) bar.classList.add("p-danger");
    else if (ratio >= 0.8) bar.classList.add("p-warning");
    return wrap;
  }

  function seatsCell(active, max) {
    return el("div", { className: "seats-cell" }, el("span", { text: seatsText(active, max) }), seatsBar(active, max, { compact: true }));
  }

  // ---------- Data (per pagina één keer ophalen) ----------

  let plansPromise;
  let companiesPromise;

  function loadPlans() {
    plansPromise = plansPromise || api.get("/api/admin/plans");
    return plansPromise;
  }

  function loadCompanies({ refresh = false } = {}) {
    if (refresh) companiesPromise = undefined;
    companiesPromise = companiesPromise || api.get("/api/admin/companies");
    return companiesPromise;
  }

  function companyOptions(companies, { onlyActive = false } = {}) {
    return companies
      .filter((c) => !onlyActive || c.status === "active")
      .map((c) => ({ value: c.id, label: c.status === "active" ? c.name : `${c.name} (${DPP.statusLabel(c.status)})` }));
  }

  // Inactieve plannen blijven kiesbaar als het huidige plan van een bedrijf, verder niet.
  function planOptions(plans, currentPlanId) {
    return [
      { value: "", label: "Geen plan" },
      ...plans
        .filter((p) => p.is_active || p.id === currentPlanId)
        .map((p) => ({ value: p.id, label: `${p.name} — max. ${DPP.formatNumber(p.max_users)} gebruikers${p.is_active ? "" : " (inactief)"}` }))
    ];
  }

  // ---------- Uitnodigingen ----------

  function showActivationLink({ activationUrl, invitation }) {
    DPP.showSecretOnce({
      title: "Activatielink",
      intro: `Stuur deze link naar ${invitation.email}. De link is 72 uur geldig en kan maar één keer worden gebruikt. De ontvanger kiest zelf een wachtwoord; MFA wordt bij de eerste login ingesteld.`,
      fields: [{ label: "Activatielink", value: activationUrl }]
    });
  }

  // companyId vast (bedrijfspagina) of een keuzelijst met actieve bedrijven.
  async function openInviteModal({ companyId, companyName, onDone } = {}) {
    let companyField = null;
    if (!companyId) {
      const companies = await loadCompanies();
      const active = companyOptions(companies, { onlyActive: true });
      if (active.length === 0) {
        DPP.showError("Er is nog geen actief bedrijf. Maak eerst een bedrijf aan.");
        return;
      }
      companyField = { name: "companyId", label: "Bedrijf", type: "select", required: true, full: true, options: [{ value: "", label: "Kies een bedrijf…" }, ...active] };
    }

    const roleInfo = el(
      "div",
      { className: "form-field full" },
      el("label", { text: "Rol" }),
      el("div", { className: "static-value" }, el("span", { className: "badge badge-role", text: DPP.roleLabel("company_admin") })),
      el("div", { className: "help", text: "Uitnodigingen zijn altijd voor de rol Company Admin. Medewerkers worden door de Company Admin zelf aangemaakt." })
    );

    formModal({
      title: "Company Admin uitnodigen",
      submitLabel: "Uitnodiging aanmaken",
      intro: companyName ? `Nieuwe beheerder voor ${companyName}.` : undefined,
      fields: [
        companyField,
        { name: "firstName", label: "Voornaam", maxlength: 100, autocomplete: "off" },
        { name: "lastName", label: "Achternaam", maxlength: 100, autocomplete: "off" },
        { name: "email", label: "E-mailadres", type: "email", required: true, full: true, maxlength: 256, autocomplete: "off" },
        roleInfo
      ].filter(Boolean),
      onSubmit: async (data, form, close) => {
        const targetCompany = companyId || Number(data.companyId);
        const result = await api.post(`/api/admin/companies/${encodeURIComponent(targetCompany)}/invitations`, {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName
        });
        close();
        showActivationLink(result);
        if (onDone) onDone(result.invitation);
      }
    });
  }

  async function revokeInvitation(invitation, onDone) {
    const ok = await confirmDialog({
      title: "Uitnodiging intrekken",
      message: `De activatielink voor ${invitation.email} werkt daarna niet meer. Doorgaan?`,
      confirmLabel: "Intrekken",
      danger: true
    });
    if (!ok) return;
    try {
      await api.post(`/api/admin/invitations/${encodeURIComponent(invitation.id)}/revoke`);
      DPP.showSuccess("Uitnodiging ingetrokken.");
      if (onDone) onDone();
    } catch (error) {
      DPP.showError(error);
    }
  }

  async function resendInvitation(invitation, onDone) {
    const ok = await confirmDialog({
      title: "Nieuwe activatielink",
      message: `De huidige link voor ${invitation.email} wordt ingetrokken en er komt een nieuwe link (72 uur geldig). Doorgaan?`,
      confirmLabel: "Nieuwe link maken"
    });
    if (!ok) return;
    try {
      const result = await api.post(`/api/admin/invitations/${encodeURIComponent(invitation.id)}/resend`);
      showActivationLink(result);
      if (onDone) onDone();
    } catch (error) {
      DPP.showError(error);
    }
  }

  function invitationActions(invitation, onChange) {
    const buttons = [];
    if (invitation.status === "pending" || invitation.status === "expired") {
      buttons.push(
        el("button", {
          className: "btn btn-secondary btn-sm",
          text: "Opnieuw versturen",
          attrs: { type: "button" },
          on: { click: () => resendInvitation(invitation, onChange) }
        })
      );
    }
    if (invitation.status === "pending") {
      buttons.push(
        el("button", {
          className: "btn btn-ghost btn-sm btn-ghost-danger",
          text: "Intrekken",
          attrs: { type: "button" },
          on: { click: () => revokeInvitation(invitation, onChange) }
        })
      );
    }
    return buttons.length ? el("div", { className: "row-actions" }, buttons) : el("span", { className: "muted", text: "—" });
  }

  // Vier kolommen in plaats van zeven: met aparte kolommen voor bedrijf, vervaldatum en
  // aanmaker werd de tabel breder dan .content en vielen de actieknoppen op elke gangbare
  // schermbreedte buiten beeld. De knoppen zijn het belangrijkste, dus die blijven los.
  function renderInvitations(container, rows, { showCompany = false, onChange, empty } = {}) {
    const columns = [
      {
        label: showCompany ? "Uitgenodigde / bedrijf" : "Uitgenodigde",
        className: "cell-wrap",
        render: (inv) =>
          showCompany
            ? el(
                "div",
                { className: "cell-stack" },
                personCell(inv),
                el("a", { className: "muted", text: inv.company_name || "—", attrs: { href: `/admin/company.html?id=${encodeURIComponent(inv.company_id)}` } })
              )
            : personCell(inv)
      },
      {
        label: "Status",
        render: (inv) =>
          el(
            "div",
            { className: "cell-stack" },
            // Badge in een span, anders rekt de flex-kolom hem op tot de volle celbreedte.
            el("span", null, DPP.statusBadge(inv.status)),
            inv.status === "pending" || inv.status === "expired"
              ? el("span", { className: "muted", text: `verloopt ${DPP.formatDateTime(inv.expires_at)}` })
              : null
          )
      },
      {
        label: "Aangemaakt",
        className: "hide-tablet",
        render: (inv) =>
          el(
            "div",
            { className: "cell-stack" },
            el("span", { text: DPP.formatDateTime(inv.created_at) }),
            el("span", { className: "muted", text: inv.created_by_email ? `door ${inv.created_by_email}` : "—" })
          )
      },
      { label: "", className: "text-right col-actions", render: (inv) => invitationActions(inv, onChange) }
    ];
    DPP.renderTable(container, { columns, rows, empty: empty || "Geen uitnodigingen" });
  }

  // ---------- Audit ----------

  function formatValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "ja" : "nee";
    if (Array.isArray(value)) return value.map(formatValue).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  // Korte, leesbare samenvatting van de metadata als platte tekst (nooit als HTML).
  function metadataSummary(metadata, max = 140) {
    if (!metadata || typeof metadata !== "object") return "";
    const parts = [];
    if ("from" in metadata || "to" in metadata) {
      parts.push(`${formatValue(DPP.STATUS_LABELS[metadata.from] ? DPP.statusLabel(metadata.from) : metadata.from)} → ${formatValue(DPP.STATUS_LABELS[metadata.to] ? DPP.statusLabel(metadata.to) : metadata.to)}`);
    }
    for (const [key, value] of Object.entries(metadata)) {
      if (key === "from" || key === "to") continue;
      if (key === "changes" && value && typeof value === "object") {
        for (const [field, change] of Object.entries(value)) {
          parts.push(`${field}: ${formatValue(change && change.from)} → ${formatValue(change && change.to)}`);
        }
        continue;
      }
      parts.push(`${key}: ${formatValue(value)}`);
    }
    const text = parts.join(" · ");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function auditTarget(item) {
    return `${entityLabel(item.entity_type)}${item.entity_id != null ? ` #${item.entity_id}` : ""}`;
  }

  // Naam vet met e-mail eronder; zonder naam alleen het e-mailadres (niet twee keer).
  function personCell(person, extra) {
    const name = [person.first_name, person.last_name].filter(Boolean).join(" ");
    return el(
      "div",
      { className: "cell-stack" },
      el("span", { className: "cell-strong" }, name || person.email || "—", extra || null),
      name && person.email ? el("span", { className: "muted", text: person.email }) : null
    );
  }

  function yesNoBadge(value, { yes = "Ja", no = "Nee" } = {}) {
    return el("span", { className: `badge ${value ? "badge-active" : "badge-muted"}`, text: value ? yes : no });
  }

  DPP.admin = {
    COMPANY_STATUS_OPTIONS,
    USER_STATUS_OPTIONS,
    INVITE_STATUS_OPTIONS,
    PRODUCT_STATUS_OPTIONS,
    COMPANY_ROLE_OPTIONS,
    AUDIT_ACTION_LABELS,
    ENTITY_LABELS,
    actionLabel,
    entityLabel,
    options,
    select,
    debounce,
    withBusy,
    confirmDialog,
    formModal,
    showFormError,
    clearFieldErrors,
    textValue,
    numberOrNull,
    seatsText,
    seatsBar,
    seatsCell,
    loadPlans,
    loadCompanies,
    companyOptions,
    planOptions,
    openInviteModal,
    revokeInvitation,
    resendInvitation,
    renderInvitations,
    metadataSummary,
    auditTarget,
    personCell,
    yesNoBadge
  };
})();
