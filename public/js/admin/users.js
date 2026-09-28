// Alle gebruikers van het platform (System Owner). Filters op bedrijf/rol/status gaan naar
// de API; zoeken op naam/e-mail gebeurt in de browser. Tijdelijke wachtwoorden worden
// alleen via DPP.showSecretOnce getoond en nergens bewaard.
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");

  const newButton = el("button", { className: "btn", text: "Nieuwe gebruiker", attrs: { type: "button" }, on: { click: () => openCreateModal() } });
  content.appendChild(DPP.pageHeader({ title: "Gebruikers", subtitle: "Alle gebruikers van alle bedrijven. Statuswijzigingen en resets worden vastgelegd in de audit log.", actions: [newButton] }));

  const roleOptions = ["system_owner", ...A.COMPANY_ROLE_OPTIONS.map((o) => o.value)].map((role) => ({ value: role, label: DPP.roleLabel(role) }));

  const search = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op naam of e-mail…", "aria-label": "Zoeken" } });
  const companyFilter = A.select("companyId", [{ value: "", label: "Alle bedrijven" }], { label: "Bedrijf" });
  const roleFilter = A.select("role", A.options(roleOptions, "Alle rollen"), { label: "Rol" });
  const statusFilter = A.select("status", A.options(A.USER_STATUS_OPTIONS, "Alle statussen"), { label: "Status" });
  const count = el("span", { className: "toolbar-count muted" });
  const tableContainer = el("div");
  content.appendChild(el("div", { className: "toolbar" }, search, companyFilter, roleFilter, statusFilter, el("div", { className: "spacer" }), count));
  content.appendChild(tableContainer);

  let users = [];
  let companies = [];
  let localMode = false;

  try {
    const [companyList, settings] = await Promise.all([A.loadCompanies(), api.get("/api/admin/settings")]);
    companies = companyList;
    // Zelfde beslissing als de backend (isEntraConfigured): alleen met login én Graph gaan
    // nieuwe gebruikers via Entra; anders lokale modus met optioneel eigen wachtwoord.
    // Alleen zonder Entra-loginconfig is een lokaal wachtwoord zinvol; met alleen de login-vars
    // (nog geen Graph) weigert de backend het aanmaken toch (503 IDENTITY_PROVIDER_NOT_CONFIGURED).
    localMode = !settings.entraLoginConfigured;
  } catch (error) {
    DPP.showError(error);
  }
  DPP.append(companyFilter, A.companyOptions(companies).map((o) => el("option", { text: o.label, attrs: { value: o.value } })));

  const initialCompany = DPP.getQueryParam("companyId");
  if (initialCompany && companies.some((c) => String(c.id) === initialCompany)) companyFilter.value = initialCompany;

  function isSelf(row) {
    return row.id === user.id;
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const rows = users.filter((u) => !term || [u.email, u.first_name, u.last_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
    count.textContent = `${rows.length} gebruiker${rows.length === 1 ? "" : "s"}`;
    DPP.renderTable(tableContainer, {
      rows,
      empty: "Geen gebruikers gevonden met deze filters",
      onRowClick: (row) => openManageModal(row),
      columns: [
        { label: "Naam", render: (u) => A.personCell(u, isSelf(u) ? el("span", { className: "badge badge-muted badge-inline", text: "Jij" }) : null) },
        { label: "Bedrijf", render: (u) => u.company_name || el("span", { className: "muted", text: "Platform" }) },
        { label: "Rol", render: (u) => DPP.roleLabel(u.role) },
        { label: "Status", render: (u) => DPP.statusBadge(u.status) },
        { label: "Identiteit", className: "hide-tablet", render: (u) => (u.identity === "entra" ? "Entra ID" : "Lokaal") },
        { label: "Laatste login", className: "nowrap", render: (u) => (u.last_login_at ? DPP.formatDateTime(u.last_login_at) : el("span", { className: "muted", text: "Nooit" })) },
        {
          // Op tablet verborgen: tikken op de rij opent dezelfde beheerdialoog.
          label: "",
          className: "text-right col-actions hide-tablet",
          render: (u) =>
            el("button", {
              className: "btn btn-secondary btn-sm",
              text: "Beheren",
              attrs: { type: "button" },
              on: {
                click: (event) => {
                  event.stopPropagation();
                  openManageModal(u);
                }
              }
            })
        }
      ]
    });
  }

  async function load() {
    const params = new URLSearchParams();
    if (companyFilter.value) params.set("companyId", companyFilter.value);
    if (roleFilter.value) params.set("role", roleFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    const query = params.toString();
    try {
      users = await api.get(`/api/users${query ? `?${query}` : ""}`);
    } catch (error) {
      DPP.showError(error);
      users = [];
    }
    render();
  }

  // ---------- Status / reset ----------

  const STATUS_CHANGES = {
    active: { label: "Activeren", title: "Gebruiker activeren", confirm: "Activeren", success: "Gebruiker geactiveerd.", text: (u) => `${u.email} kan daarna weer inloggen. Dit gebruikt een seat van het bedrijf.` },
    inactive: {
      label: "Deactiveren",
      title: "Gebruiker deactiveren",
      confirm: "Deactiveren",
      danger: true,
      success: "Gebruiker gedeactiveerd.",
      text: (u) => `${u.email} kan niet meer inloggen en lopende sessies worden direct beëindigd. De seat komt vrij.`
    },
    blocked: {
      label: "Blokkeren",
      title: "Gebruiker blokkeren",
      confirm: "Blokkeren",
      danger: true,
      success: "Gebruiker geblokkeerd.",
      text: (u) => `Gebruik blokkeren bij misbruik of een gecompromitteerd account. ${u.email} kan niet meer inloggen en lopende sessies worden direct beëindigd.`
    }
  };

  async function changeStatus(target, status) {
    const change = STATUS_CHANGES[status];
    if (!(await A.confirmDialog({ title: change.title, message: change.text(target), confirmLabel: change.confirm, danger: change.danger }))) return;
    try {
      await api.patch(`/api/users/${encodeURIComponent(target.id)}`, { status });
      DPP.showSuccess(change.success);
      await load();
    } catch (error) {
      DPP.showError(error);
    }
  }

  async function resetPassword(target) {
    const ok = await A.confirmDialog({
      title: "Wachtwoord resetten",
      message: `Er wordt een nieuw tijdelijk wachtwoord voor ${target.email} gemaakt. Het huidige wachtwoord werkt dan niet meer en alle sessies worden beëindigd.`,
      confirmLabel: "Wachtwoord resetten",
      danger: true
    });
    if (!ok) return;
    try {
      const result = await api.post(`/api/users/${encodeURIComponent(target.id)}/reset-password`);
      DPP.showSecretOnce({
        title: "Tijdelijk wachtwoord",
        intro:
          target.identity === "entra"
            ? `Geef dit tijdelijke wachtwoord aan ${target.email}. Bij de volgende login moet de gebruiker een eigen wachtwoord kiezen.`
            : `Geef dit tijdelijke wachtwoord aan ${target.email}.`,
        fields: [
          { label: "E-mailadres", value: target.email },
          { label: "Tijdelijk wachtwoord", value: result.tempPassword }
        ]
      });
      await load();
    } catch (error) {
      DPP.showError(error);
    }
  }

  // ---------- Beheren ----------

  function openManageModal(target) {
    const self = isSelf(target);
    const isOwner = target.role === "system_owner";
    const errorBox = el("div", { attrs: { "aria-live": "polite" } });

    const fields = [
      { name: "firstName", label: "Voornaam", maxlength: 100, value: target.first_name },
      { name: "lastName", label: "Achternaam", maxlength: 100, value: target.last_name },
      isOwner
        ? { name: "roleDisplay", label: "Rol", value: DPP.roleLabel(target.role), disabled: true, full: true, help: "De rol System Owner kan niet via gebruikersbeheer worden gewijzigd." }
        : {
            name: "role",
            label: "Rol",
            type: "select",
            full: true,
            value: target.role,
            options: A.COMPANY_ROLE_OPTIONS,
            disabled: self,
            help: self ? "Je kunt je eigen rol niet wijzigen." : "Een rolwijziging beëindigt alle sessies van deze gebruiker."
          }
    ];

    const form = el("form", { className: "form-grid", attrs: { novalidate: true } }, fields.map((spec) => DPP.field(spec)));
    const saveButton = el("button", { className: "btn", text: "Opslaan", attrs: { type: "submit" } });
    form.appendChild(el("div", { className: "form-actions full" }, saveButton));

    let handle;
    const after = (fn) => () => {
      handle.close();
      fn();
    };

    // De backend weigert status/wachtwoord van een system_owner-account (400 ROLE_NOT_ALLOWED).
    const statusButtons = self
      ? [el("p", { className: "muted", text: "Dit is je eigen account: status en wachtwoord beheer je hier niet." })]
      : isOwner
      ? [el("p", { className: "muted", text: "Status en wachtwoord van een System Owner beheer je via Entra External ID of scripts/seed-system-owner.js." })]
      : [
          ...["active", "inactive", "blocked"]
            .filter((status) => status !== target.status)
            .map((status) =>
              el("button", {
                className: STATUS_CHANGES[status].danger ? "btn btn-secondary btn-danger-outline btn-sm" : "btn btn-secondary btn-sm",
                text: STATUS_CHANGES[status].label,
                attrs: { type: "button" },
                on: { click: after(() => changeStatus(target, status)) }
              })
            ),
          el("button", { className: "btn btn-secondary btn-sm", text: "Wachtwoord resetten", attrs: { type: "button" }, on: { click: after(() => resetPassword(target)) } })
        ];

    const body = el(
      "div",
      { className: "manage-user" },
      el(
        "dl",
        { className: "detail-list detail-compact" },
        el("dt", { text: "E-mailadres" }),
        el("dd", { text: target.email }),
        el("dt", { text: "Bedrijf" }),
        el("dd", { text: target.company_name || "Platform (geen bedrijf)" }),
        el("dt", { text: "Status" }),
        el("dd", null, DPP.statusBadge(target.status)),
        el("dt", { text: "Identiteit" }),
        el("dd", { text: target.identity === "entra" ? "Entra External ID" : "Lokaal account (ontwikkelmodus)" }),
        el("dt", { text: "Laatste login" }),
        el("dd", { text: target.last_login_at ? DPP.formatDateTime(target.last_login_at) : "Nooit" }),
        el("dt", { text: "Aangemaakt" }),
        el("dd", { text: DPP.formatDateTime(target.created_at) })
      ),
      el("h3", { className: "section-title", text: "Gegevens" }),
      errorBox,
      form,
      el("h3", { className: "section-title", text: "Account" }),
      el("div", { className: "row" }, statusButtons)
    );

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      DPP.clear(errorBox);
      A.clearFieldErrors(form);
      const body = { firstName: A.textValue(form, "firstName"), lastName: A.textValue(form, "lastName") };
      const roleControl = form.elements.namedItem("role");
      // Rol alleen meesturen als die echt verandert (en nooit voor een System Owner).
      if (roleControl && !roleControl.disabled && roleControl.value !== target.role) {
        // MFA voor Company Admins hangt aan de Conditional Access-policy "iedereen behalve
        // DPP-Standard-Users", en die groep wordt handmatig beheerd. Een gepromoveerde
        // medewerker zit meestal al in die groep en houdt dan géén verplichte MFA (fail-open,
        // anders dan een nieuw uitgenodigd account). Lokale accounts hebben geen Entra-MFA,
        // daar zou de waarschuwing alleen ruis zijn.
        const promotingToAdmin = roleControl.value === "company_admin" && target.identity === "entra";
        const ok = await A.confirmDialog({
          title: "Rol wijzigen",
          message:
            `${target.email} wordt ${DPP.roleLabel(roleControl.value)}. Alle sessies van deze gebruiker worden beëindigd.` +
            (promotingToAdmin
              ? " Haal deze gebruiker in Entra direct uit de groep DPP-Standard-Users, anders geldt er geen verplichte MFA (zie docs/entra-external-id-setup.md §6)."
              : ""),
          confirmLabel: "Rol wijzigen",
          danger: promotingToAdmin
        });
        if (!ok) return;
        body.role = roleControl.value;
      }
      await A.withBusy(saveButton, async () => {
        try {
          await api.patch(`/api/users/${encodeURIComponent(target.id)}`, body);
          handle.close();
          DPP.showSuccess("Gebruiker bijgewerkt.");
          await load();
        } catch (error) {
          A.showFormError(errorBox, form, error);
        }
      });
    });

    handle = DPP.openModal({
      title: DPP.fullName(target),
      wide: true,
      body,
      actions: [{ label: "Sluiten", className: "btn btn-secondary", onClick: (close) => close() }]
    });
  }

  // ---------- Aanmaken ----------

  function openCreateModal() {
    const active = A.companyOptions(companies, { onlyActive: true });
    if (active.length === 0) {
      DPP.showError("Er is nog geen actief bedrijf. Maak eerst een bedrijf aan.");
      return;
    }
    const preselected = active.some((o) => String(o.value) === companyFilter.value) ? companyFilter.value : "";
    // Company Admins lopen via de uitnodigingsflow (eigen wachtwoord + MFA), niet via hier.
    const createRoles = A.COMPANY_ROLE_OPTIONS.filter((o) => o.value !== "company_admin");

    const fields = [
      { name: "companyId", label: "Bedrijf", type: "select", required: true, full: true, value: preselected, options: [{ value: "", label: "Kies een bedrijf…" }, ...active] },
      {
        name: "role",
        label: "Rol",
        type: "select",
        required: true,
        value: "company_user",
        options: createRoles,
        help: "Een Company Admin nodig je uit via Company Admins → Uitnodigen."
      },
      { name: "status", label: "Status", type: "select", value: "active", options: [{ value: "active", label: "Actief" }, { value: "inactive", label: "Inactief (telt geen seat)" }] },
      { name: "firstName", label: "Voornaam", maxlength: 100, autocomplete: "off" },
      { name: "lastName", label: "Achternaam", maxlength: 100, autocomplete: "off" },
      { name: "email", label: "E-mailadres", type: "email", required: true, full: true, maxlength: 256, autocomplete: "off" }
    ];
    if (localMode) {
      fields.push({
        name: "password",
        label: "Wachtwoord (optioneel)",
        type: "password",
        full: true,
        maxlength: 256,
        autocomplete: "new-password",
        help: "Alleen in de lokale ontwikkelmodus. Leeg laten = tijdelijk wachtwoord genereren. Minimaal 12 tekens met hoofdletter, kleine letter, cijfer en symbool."
      });
    }

    A.formModal({
      title: "Nieuwe gebruiker",
      submitLabel: "Gebruiker aanmaken",
      wide: true,
      intro: localMode ? undefined : "De gebruiker krijgt een Entra-account met een tijdelijk wachtwoord dat bij de eerste login gewijzigd moet worden.",
      fields,
      onSubmit: async (data, form, close) => {
        const created = await api.post("/api/users", {
          companyId: Number(data.companyId),
          role: data.role,
          status: data.status,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          password: localMode ? data.password : undefined
        });
        close();
        if (created.tempPassword) {
          DPP.showSecretOnce({
            title: "Gebruiker aangemaakt",
            intro: `Geef deze inloggegevens aan ${created.email}. Er wordt geen e-mail verstuurd.`,
            fields: [
              { label: "E-mailadres", value: created.email },
              { label: "Tijdelijk wachtwoord", value: created.tempPassword }
            ]
          });
        } else {
          DPP.showSuccess(`Gebruiker ${created.email} aangemaakt.`);
        }
        await load();
      }
    });
  }

  search.addEventListener("input", A.debounce(render, 120));
  for (const filter of [companyFilter, roleFilter, statusFilter]) filter.addEventListener("change", load);

  await load();
});
