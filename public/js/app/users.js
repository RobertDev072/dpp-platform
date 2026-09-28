// Gebruikersbeheer voor de Company Admin (users:manage). Tenant-scope komt uit de sessie:
// de API geeft alleen gebruikers van de eigen company. Company Admins (ook de ingelogde
// gebruiker zelf) worden getoond maar niet beheerd — dat loopt via platformbeheer. De
// backend weigert dat ook (403 ROLE_NOT_ASSIGNABLE / 400 CANNOT_MODIFY_SELF).
// Tijdelijke wachtwoorden gaan alleen naar DPP.showSecretOnce en worden nergens bewaard.
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  const STATUS_OPTIONS = [
    { value: "active", label: "Actief" },
    { value: "inactive", label: "Inactief" },
    { value: "blocked", label: "Geblokkeerd" }
  ];

  const ROLE_FILTER_OPTIONS = ["company_admin", ...A.ASSIGNABLE_ROLES].map((role) => ({ value: role, label: DPP.roleLabel(role) }));
  const ASSIGNABLE_OPTIONS = A.ASSIGNABLE_ROLES.map((role) => ({ value: role, label: DPP.roleLabel(role) }));

  function roleHelp() {
    return el(
      "div",
      { className: "form-field full" },
      el(
        "ul",
        { className: "role-help" },
        A.ASSIGNABLE_ROLES.map((role) => el("li", null, el("strong", { text: `${DPP.roleLabel(role)}: ` }), A.ROLE_DESCRIPTIONS[role]))
      )
    );
  }

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");

    const state = { users: [], company: null };

    const addButton = el("button", { className: "btn", text: "Medewerker toevoegen", attrs: { type: "button" }, on: { click: () => openCreateModal() } });
    content.appendChild(
      DPP.pageHeader({
        title: "Gebruikers",
        subtitle: "Medewerkers van je bedrijf, hun rol en toegang.",
        actions: [addButton]
      })
    );

    const seatsSlot = el("div");
    const search = el("input", { className: "input toolbar-search", attrs: { type: "search", placeholder: "Zoek op naam of e-mail…", "aria-label": "Zoeken", maxlength: 200 } });
    const roleSelect = A.select("role", [{ value: "", label: "Alle rollen" }, ...ROLE_FILTER_OPTIONS], { label: "Rol" });
    const statusSelect = A.select("status", [{ value: "", label: "Alle statussen" }, ...STATUS_OPTIONS], { label: "Status" });
    const count = el("span", { className: "toolbar-count muted" });
    const tableHolder = el("div", null, A.loadingState());

    content.appendChild(seatsSlot);
    content.appendChild(el("div", { className: "toolbar" }, search, roleSelect, statusSelect, el("span", { className: "spacer" }), count));
    content.appendChild(tableHolder);

    function seats() {
      return (state.company && state.company.seats) || { maxUsers: null, activeUsers: 0, remainingSeats: null };
    }

    function limitReached() {
      const s = seats();
      return s.maxUsers != null && s.remainingSeats != null && s.remainingSeats <= 0;
    }

    function renderSeats() {
      DPP.clear(seatsSlot);
      const s = seats();
      const plan = state.company && state.company.plan ? state.company.plan.name : null;
      const figure =
        s.maxUsers == null
          ? el("div", { className: "seats-figure" }, el("span", { className: "seats-number", text: DPP.formatNumber(s.activeUsers) }), el("span", { className: "muted", text: "actieve gebruikers · onbeperkt" }))
          : el(
              "div",
              { className: "seats-figure" },
              el("span", { className: "seats-number", text: `${DPP.formatNumber(s.activeUsers)} / ${DPP.formatNumber(s.maxUsers)}` }),
              el("span", { className: "muted", text: "licenties in gebruik" })
            );
      const meta = el(
        "div",
        { className: "seats-meta" },
        el("span", { text: plan ? `Plan: ${plan}` : "Geen plan" }),
        s.maxUsers != null ? el("span", { text: `${DPP.formatNumber(Math.max(0, s.remainingSeats))} beschikbaar` }) : null,
        el("span", { text: "Alleen actieve gebruikers tellen mee" })
      );
      const card = el("div", { className: "card seats-card" }, figure, meta, A.seatsBar(s.activeUsers, s.maxUsers));
      if (limitReached()) {
        card.appendChild(
          el(
            "div",
            { className: "alert alert-warning" },
            el("span", {
              text: "Alle licenties zijn in gebruik. Nieuwe medewerkers kun je alleen als inactief aanmaken; deactiveer eerst iemand of vraag platformbeheer om extra licenties."
            })
          )
        );
      }
      seatsSlot.appendChild(card);
    }

    function isManageable(target) {
      return target.id !== user.id && A.ASSIGNABLE_ROLES.includes(target.role);
    }

    function nameCell(target) {
      return el(
        "div",
        { className: "cell-stack" },
        el("span", { className: "cell-strong" }, DPP.fullName(target), target.id === user.id ? el("span", { className: "badge badge-self", text: "Jij" }) : null),
        el("span", { className: "muted show-tablet", text: target.email }),
        // Op tablet vervalt de kolom "Laatste login"; dan staat die hier, zodat de acties passen.
        el("span", { className: "muted show-tablet", text: target.last_login_at ? `Laatste login ${DPP.formatDate(target.last_login_at)}` : "Nog nooit ingelogd" })
      );
    }

    function actionsCell(target) {
      if (target.id === user.id) return el("span", { className: "muted", text: "Eigen account" });
      if (!isManageable(target)) return el("span", { className: "muted", text: "Beheerd door platformbeheer" });
      return A.actionMenu([
        { label: "Naam en rol wijzigen", onClick: () => openEditModal(target) },
        target.status !== "active" ? { label: "Activeren", onClick: () => changeStatus(target, "active") } : null,
        target.status === "active" ? { label: "Deactiveren", onClick: () => changeStatus(target, "inactive") } : null,
        target.status !== "blocked" ? { label: "Blokkeren", danger: true, onClick: () => changeStatus(target, "blocked") } : null,
        "separator",
        { label: "Wachtwoord resetten", onClick: () => resetPassword(target) }
      ]);
    }

    function renderTable() {
      const q = search.value.trim().toLowerCase();
      const rows = state.users.filter((u) => {
        if (roleSelect.value && u.role !== roleSelect.value) return false;
        if (statusSelect.value && u.status !== statusSelect.value) return false;
        if (q && !`${DPP.fullName(u)} ${u.email}`.toLowerCase().includes(q)) return false;
        return true;
      });
      count.textContent = `${DPP.formatNumber(rows.length)} ${rows.length === 1 ? "gebruiker" : "gebruikers"}`;
      DPP.renderTable(tableHolder, {
        columns: [
          { label: "Naam", render: nameCell },
          { label: "E-mail", className: "hide-tablet", render: (u) => u.email },
          { label: "Rol", render: (u) => el("span", { className: "badge badge-role", text: DPP.roleLabel(u.role) }) },
          { label: "Status", render: (u) => DPP.statusBadge(u.status) },
          { label: "Laatste login", className: "nowrap hide-tablet", render: (u) => (u.last_login_at ? DPP.formatDateTime(u.last_login_at) : el("span", { className: "muted", text: "Nog nooit" })) },
          { label: "", className: "col-actions", render: actionsCell }
        ],
        rows,
        empty: state.users.length ? "Geen gebruikers gevonden voor deze filters." : "Nog geen gebruikers."
      });
    }

    async function load() {
      try {
        const [users, company] = await Promise.all([api.get("/api/users"), api.get("/api/company")]);
        // Actief eerst, daarna op naam: de lijst die je het vaakst nodig hebt staat bovenaan.
        const order = { active: 0, inactive: 1, blocked: 2 };
        state.users = users.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || DPP.fullName(a).localeCompare(DPP.fullName(b), "nl"));
        state.company = company;
        renderSeats();
        renderTable();
      } catch (error) {
        DPP.clear(tableHolder);
        tableHolder.appendChild(A.errorCard("Gebruikers konden niet worden geladen", A.errorMessage(error)));
      }
    }

    function openCreateModal() {
      const full = limitReached();
      A.formModal({
        title: "Medewerker toevoegen",
        submitLabel: "Account aanmaken",
        intro: el(
          "div",
          null,
          el("p", {
            className: "modal-intro",
            text: "Er wordt geen e-mail verstuurd. Na het aanmaken zie je één keer een tijdelijk wachtwoord dat je zelf via een veilig intern kanaal deelt."
          }),
          full
            ? el("div", { className: "alert alert-warning" }, el("span", { text: "Alle licenties zijn in gebruik: de medewerker kan alleen als inactief worden aangemaakt." }))
            : null
        ),
        fields: [
          { name: "firstName", label: "Voornaam", maxlength: 100, autocomplete: "off" },
          { name: "lastName", label: "Achternaam", maxlength: 100, autocomplete: "off" },
          { name: "email", label: "E-mailadres", type: "email", required: true, full: true, maxlength: 256, autocomplete: "off" },
          { name: "role", label: "Rol", type: "select", required: true, options: [{ value: "", label: "Kies een rol…" }, ...ASSIGNABLE_OPTIONS] },
          {
            name: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "active", label: "Actief (telt als licentie)" },
              { value: "inactive", label: "Inactief (kan nog niet inloggen)" }
            ],
            value: full ? "inactive" : "active"
          },
          roleHelp()
        ],
        onSubmit: async (data, form, close) => {
          const created = await api.post("/api/users", {
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            role: data.role,
            status: data.status || "active"
          });
          close();
          await load();
          if (created.tempPassword) {
            DPP.showSecretOnce({
              title: "Medewerker aangemaakt",
              intro: `${DPP.fullName(created)} is aangemaakt als ${DPP.roleLabel(created.role)}. Er is geen e-mail verstuurd: deel het e-mailadres en het tijdelijke wachtwoord zelf, bij voorkeur via een ander kanaal dan het e-mailadres zelf.`,
              fields: [
                { label: "E-mailadres", value: created.email },
                { label: "Tijdelijk wachtwoord", value: created.tempPassword }
              ]
            });
          } else {
            DPP.showSuccess("Medewerker aangemaakt.");
          }
        }
      });
    }

    function openEditModal(target) {
      A.formModal({
        title: "Naam en rol wijzigen",
        intro: `${target.email}. Bij een rolwijziging wordt de gebruiker uitgelogd en gelden de nieuwe rechten bij de volgende login.`,
        fields: [
          { name: "firstName", label: "Voornaam", maxlength: 100, autocomplete: "off", value: target.first_name || "" },
          { name: "lastName", label: "Achternaam", maxlength: 100, autocomplete: "off", value: target.last_name || "" },
          { name: "role", label: "Rol", type: "select", required: true, full: true, options: ASSIGNABLE_OPTIONS, value: target.role },
          roleHelp()
        ],
        readData: (form) => ({
          firstName: form.elements.namedItem("firstName").value.trim(),
          lastName: form.elements.namedItem("lastName").value.trim(),
          role: form.elements.namedItem("role").value
        }),
        onSubmit: async (data, form, close) => {
          // Alleen echte wijzigingen; een geleegd naamveld wordt null.
          const changes = {};
          if (data.firstName !== (target.first_name || "")) changes.firstName = data.firstName || null;
          if (data.lastName !== (target.last_name || "")) changes.lastName = data.lastName || null;
          if (data.role !== target.role) changes.role = data.role;
          if (Object.keys(changes).length === 0) {
            close();
            return;
          }
          await api.patch(`/api/users/${encodeURIComponent(target.id)}`, changes);
          close();
          DPP.showSuccess(changes.role ? `Rol gewijzigd naar ${DPP.roleLabel(changes.role)}.` : "Gegevens opgeslagen.");
          await load();
        }
      });
    }

    const STATUS_CHANGES = {
      active: { title: "Gebruiker activeren", message: (t) => `${DPP.fullName(t)} kan weer inloggen en telt als licentie.`, confirmLabel: "Activeren", success: "Gebruiker geactiveerd." },
      inactive: {
        title: "Gebruiker deactiveren",
        message: (t) => `${DPP.fullName(t)} wordt direct uitgelogd en kan niet meer inloggen. De licentie komt vrij. Je kunt de gebruiker later weer activeren.`,
        confirmLabel: "Deactiveren",
        danger: true,
        success: "Gebruiker gedeactiveerd."
      },
      blocked: {
        title: "Gebruiker blokkeren",
        message: (t) => `${DPP.fullName(t)} wordt direct uitgelogd en geblokkeerd, bijvoorbeeld bij vermoeden van misbruik. De licentie komt vrij.`,
        confirmLabel: "Blokkeren",
        danger: true,
        success: "Gebruiker geblokkeerd."
      }
    };

    async function changeStatus(target, status) {
      const spec = STATUS_CHANGES[status];
      const ok = await A.confirmDialog({ title: spec.title, message: spec.message(target), confirmLabel: spec.confirmLabel, danger: spec.danger });
      if (!ok) return;
      try {
        await api.patch(`/api/users/${encodeURIComponent(target.id)}`, { status });
        DPP.showSuccess(spec.success);
      } catch (error) {
        A.showApiError(error);
      }
      await load();
    }

    async function resetPassword(target) {
      const ok = await A.confirmDialog({
        title: "Wachtwoord resetten",
        message: `${DPP.fullName(target)} wordt uitgelogd en krijgt een nieuw tijdelijk wachtwoord. Het huidige wachtwoord werkt daarna niet meer.`,
        confirmLabel: "Wachtwoord resetten"
      });
      if (!ok) return;
      try {
        const result = await api.post(`/api/users/${encodeURIComponent(target.id)}/reset-password`);
        DPP.showSecretOnce({
          title: "Nieuw tijdelijk wachtwoord",
          intro: `Deel dit wachtwoord zelf met ${DPP.fullName(target)}. Er wordt geen e-mail verstuurd.`,
          fields: [
            { label: "E-mailadres", value: target.email },
            { label: "Tijdelijk wachtwoord", value: result.tempPassword }
          ]
        });
      } catch (error) {
        A.showApiError(error);
      }
    }

    const rerender = () => renderTable();
    search.addEventListener("input", A.debounce(rerender, 150));
    roleSelect.addEventListener("change", rerender);
    statusSelect.addEventListener("change", rerender);

    await load();

    // Snelle actie vanaf het dashboard (?nieuw=1): direct het formulier openen en de
    // parameter weer uit de adresbalk halen, zodat verversen het niet opnieuw opent.
    if (new URLSearchParams(window.location.search).get("nieuw") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      openCreateModal();
    }
  });
})();
