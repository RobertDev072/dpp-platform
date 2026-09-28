// Bedrijfsdetail (System Owner): gegevens, plan/seats, status, Company Admins en
// uitnodigingen. Bron: GET /api/admin/companies/:id (incl. seats, admins, invitations).
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");
  const root = el("div");
  content.appendChild(root);

  // Alleen een positief geheel getal gaat de URL van de API in; de rest is "niet gevonden".
  const rawId = DPP.getQueryParam("id");
  const companyId = /^[1-9][0-9]{0,9}$/.test(rawId || "") ? Number(rawId) : null;
  const justCreated = DPP.getQueryParam("nieuw") === "1";
  if (justCreated) window.history.replaceState(null, "", `${window.location.pathname}?id=${companyId}`);

  function renderNotFound() {
    DPP.clear(root);
    root.appendChild(
      el(
        "div",
        { className: "card empty-state" },
        el("h2", { text: "Bedrijf niet gevonden" }),
        el("p", { text: "Dit bedrijf bestaat niet (meer) of de link is onjuist." }),
        el("a", { className: "btn", text: "Naar bedrijven", attrs: { href: "/admin/companies.html" } })
      )
    );
  }

  if (!companyId) {
    renderNotFound();
    return;
  }

  let plans = [];
  try {
    plans = await A.loadPlans();
  } catch (error) {
    DPP.showError(error);
  }

  async function load() {
    try {
      const company = await api.get(`/api/admin/companies/${companyId}`);
      render(company);
    } catch (error) {
      if (error.status === 404) renderNotFound();
      else DPP.showError(error);
    }
  }

  async function changeStatus(company, status) {
    const texts = {
      active: {
        title: "Bedrijf activeren",
        message: `${company.name} wordt weer actief. Gebruikers met status Actief kunnen daarna weer inloggen.`,
        confirmLabel: "Activeren",
        success: "Bedrijf geactiveerd."
      },
      suspended: {
        title: "Bedrijf deactiveren",
        message: `Alle gebruikers van ${company.name} kunnen direct niet meer inloggen en lopende sessies worden beëindigd. Openstaande uitnodigingen werken niet zolang het bedrijf gedeactiveerd is. Gegevens blijven bewaard.`,
        confirmLabel: "Deactiveren",
        danger: true,
        success: "Bedrijf gedeactiveerd."
      },
      archived: {
        title: "Bedrijf archiveren",
        message: `${company.name} wordt gearchiveerd. Gebruikers kunnen niet inloggen. Je kunt het bedrijf later weer activeren.`,
        confirmLabel: "Archiveren",
        danger: true,
        success: "Bedrijf gearchiveerd."
      }
    }[status];

    if (!(await A.confirmDialog(texts))) return;
    try {
      await api.patch(`/api/admin/companies/${companyId}`, { status });
      DPP.showSuccess(texts.success);
      await load();
    } catch (error) {
      DPP.showError(error);
    }
  }

  function statusActions(company) {
    const button = (label, className, status) =>
      el("button", { className, text: label, attrs: { type: "button" }, on: { click: () => changeStatus(company, status) } });
    const actions = [];
    if (company.status === "active") {
      actions.push(button("Deactiveren", "btn btn-secondary btn-danger-outline", "suspended"));
    } else {
      actions.push(button("Activeren", "btn btn-secondary", "active"));
      if (company.status === "suspended") actions.push(button("Archiveren", "btn btn-ghost btn-ghost-danger", "archived"));
    }
    const invite = el("button", {
      className: "btn",
      text: "Company Admin uitnodigen",
      attrs: {
        type: "button",
        disabled: company.status !== "active",
        title: company.status !== "active" ? "Alleen mogelijk voor een actief bedrijf" : undefined
      },
      on: { click: () => A.openInviteModal({ companyId, companyName: company.name, onDone: load }) }
    });
    actions.push(invite);
    return actions;
  }

  function header(company) {
    const subtitle = [company.kvk_number ? `KvK ${company.kvk_number}` : null, company.country, company.slug].filter(Boolean).join(" · ");
    return el(
      "div",
      { className: "page-header" },
      el(
        "div",
        null,
        el("a", { className: "back-link", text: "← Bedrijven", attrs: { href: "/admin/companies.html" } }),
        el("div", { className: "title-row" }, el("h1", { text: company.name }), DPP.statusBadge(company.status)),
        subtitle ? el("p", { className: "subtitle", text: subtitle }) : null
      ),
      el("div", { className: "page-actions" }, statusActions(company))
    );
  }

  function editForm(company) {
    const errorBox = el("div", { attrs: { "aria-live": "polite" } });
    const fields = [
      { name: "name", label: "Bedrijfsnaam", required: true, full: true, maxlength: 200, value: company.name },
      { name: "kvkNumber", label: "KvK-nummer", maxlength: 20, value: company.kvk_number },
      { name: "country", label: "Land", maxlength: 100, value: company.country },
      { name: "address", label: "Adres", type: "textarea", rows: 2, full: true, maxlength: 500, value: company.address },
      { name: "contactName", label: "Contactpersoon", maxlength: 200, value: company.contact_name },
      { name: "contactEmail", label: "E-mailadres contactpersoon", type: "email", maxlength: 256, value: company.contact_email },
      { name: "planId", label: "Plan", type: "select", options: A.planOptions(plans, company.plan_id), value: company.plan_id ?? "" },
      {
        name: "maxUsers",
        label: "Max. gebruikers (eigen limiet)",
        type: "number",
        min: 0,
        max: 1000000,
        value: company.max_users ?? "",
        help: company.plan_max_users != null ? `Leeg = limiet van het plan (${DPP.formatNumber(company.plan_max_users)}).` : "Leeg = limiet van het plan; zonder plan onbeperkt."
      }
    ];
    const saveButton = el("button", { className: "btn", text: "Wijzigingen opslaan", attrs: { type: "submit" } });
    const form = el(
      "form",
      { attrs: { novalidate: true } },
      errorBox,
      el("div", { className: "form-grid" }, fields.map((spec) => DPP.field(spec))),
      el("div", { className: "form-actions" }, saveButton)
    );

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      DPP.clear(errorBox);
      A.clearFieldErrors(form);
      if (!form.reportValidity()) return;
      // Lege tekstvelden sturen we als "" mee: de backend maakt daar NULL van (leegmaken).
      const body = {
        name: A.textValue(form, "name"),
        kvkNumber: A.textValue(form, "kvkNumber"),
        country: A.textValue(form, "country"),
        address: A.textValue(form, "address"),
        contactName: A.textValue(form, "contactName"),
        contactEmail: A.textValue(form, "contactEmail"),
        planId: A.numberOrNull(form.elements.namedItem("planId").value),
        maxUsers: A.numberOrNull(form.elements.namedItem("maxUsers").value)
      };
      await A.withBusy(saveButton, async () => {
        try {
          await api.patch(`/api/admin/companies/${companyId}`, body);
          DPP.showSuccess("Bedrijfsgegevens opgeslagen.");
          await load();
        } catch (error) {
          A.showFormError(errorBox, form, error);
        }
      });
    });

    return el("section", { className: "card" }, el("div", { className: "card-header" }, el("h2", { text: "Bedrijfsgegevens" })), form);
  }

  function seatsCard(company) {
    const seats = company.seats || { maxUsers: company.effective_max_users, activeUsers: 0, remainingSeats: null };
    const limitSource =
      company.max_users != null
        ? `Eigen limiet van ${DPP.formatNumber(company.max_users)} (overschrijft het plan)`
        : company.plan_id != null
          ? "Limiet volgt het plan"
          : "Geen plan en geen eigen limiet: onbeperkt";
    return el(
      "section",
      { className: "card" },
      el("div", { className: "card-header" }, el("h2", { text: "Licentie" })),
      el(
        "div",
        { className: "seats-summary" },
        el("div", { className: "seats-plan" }, el("span", { className: "muted", text: "Plan" }), el("strong", { text: company.plan_name || "Geen plan" })),
        el("div", { className: "seats-figure" }, el("span", { className: "seats-number", text: A.seatsText(seats.activeUsers, seats.maxUsers) }), el("span", { className: "muted", text: "actieve gebruikers" })),
        A.seatsBar(seats.activeUsers, seats.maxUsers),
        el(
          "p",
          { className: "seats-hint muted" },
          seats.maxUsers == null
            ? "Onbeperkt aantal seats."
            : seats.remainingSeats > 0
              ? `${DPP.formatNumber(seats.remainingSeats)} seat${seats.remainingSeats === 1 ? "" : "s"} beschikbaar.`
              : "Geen seats meer beschikbaar: nieuwe gebruikers en activaties worden geweigerd."
        ),
        el("p", { className: "seats-hint muted", text: limitSource })
      ),
      el(
        "dl",
        { className: "detail-list detail-compact" },
        el("dt", { text: "Slug" }),
        el("dd", { className: "mono", text: company.slug || "—" }),
        el("dt", { text: "Aangemaakt" }),
        el("dd", { text: DPP.formatDateTime(company.created_at) }),
        el("dt", { text: "Laatst gewijzigd" }),
        el("dd", { text: DPP.formatDateTime(company.updated_at) })
      )
    );
  }

  function adminsCard(company) {
    const container = el("div");
    DPP.renderTable(container, {
      rows: company.admins || [],
      empty: "Nog geen Company Admin. Nodig er een uit om het bedrijf te laten starten.",
      columns: [
        { label: "Naam", render: (a) => el("span", { className: "cell-strong", text: DPP.fullName(a) }) },
        { label: "E-mailadres", render: (a) => a.email },
        { label: "Status", render: (a) => DPP.statusBadge(a.status) },
        { label: "Laatste login", className: "nowrap", render: (a) => (a.last_login_at ? DPP.formatDateTime(a.last_login_at) : el("span", { className: "muted", text: "Nog niet ingelogd" })) }
      ]
    });
    return el(
      "section",
      { className: "card card-flush" },
      el(
        "div",
        { className: "card-header" },
        el("h2", { text: "Company Admins" }),
        el("a", { className: "card-link", text: "Alle gebruikers van dit bedrijf", attrs: { href: `/admin/users.html?companyId=${companyId}` } })
      ),
      container
    );
  }

  function invitationsCard(company) {
    const container = el("div");
    A.renderInvitations(container, company.invitations || [], { onChange: load, empty: "Nog geen uitnodigingen verstuurd" });
    return el(
      "section",
      { className: "card card-flush" },
      el("div", { className: "card-header" }, el("h2", { text: "Uitnodigingen" })),
      container
    );
  }

  let shownCreatedHint = false;

  function render(company) {
    document.title = `${company.name} — DPP Platformbeheer`;
    DPP.clear(root);
    root.appendChild(header(company));

    if (justCreated && !shownCreatedHint) {
      shownCreatedHint = true;
      root.appendChild(
        el(
          "div",
          { className: "alert alert-success" },
          el("span", { text: "Bedrijf aangemaakt. Volgende stap: nodig een Company Admin uit. Die activeert het account via de link en beheert daarna zelf de medewerkers." })
        )
      );
    }

    root.appendChild(el("div", { className: "detail-columns" }, editForm(company), el("div", null, seatsCard(company))));
    root.appendChild(adminsCard(company));
    root.appendChild(invitationsCard(company));
  }

  await load();
});
