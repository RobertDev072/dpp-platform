// Licentieplannen (System Owner). Geen verwijderen: bedrijven verwijzen naar hun plan;
// uitfaseren = op inactief zetten (dan niet meer kiesbaar voor nieuwe bedrijven).
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const A = DPP.admin;
  const content = document.getElementById("content");

  const newButton = el("button", { className: "btn", text: "Nieuw plan", attrs: { type: "button" }, on: { click: () => openPlanModal(null) } });
  content.appendChild(
    DPP.pageHeader({
      title: "Licenties",
      subtitle: "Plannen bepalen het standaard aantal gebruikers (seats) en producten per bedrijf. Per bedrijf kun je de gebruikerslimiet overschrijven.",
      actions: [newButton]
    })
  );

  const tableContainer = el("div");
  content.appendChild(tableContainer);

  let plans = [];

  function render() {
    DPP.renderTable(tableContainer, {
      rows: plans,
      empty: "Nog geen plannen. Maak een plan aan om licenties toe te kennen.",
      onRowClick: (row) => openPlanModal(row),
      columns: [
        {
          label: "Plan",
          render: (p) =>
            el("div", { className: "cell-stack" }, el("span", { className: "cell-strong", text: p.name }), p.description ? el("span", { className: "muted", text: p.description }) : null)
        },
        { label: "Max. gebruikers", className: "num", render: (p) => DPP.formatNumber(p.max_users) },
        { label: "Richtlijn producten", className: "num", render: (p) => DPP.formatNumber(p.max_products) },
        { label: "Status", render: (p) => A.yesNoBadge(p.is_active, { yes: "Actief", no: "Inactief" }) },
        { label: "Bedrijven", className: "num", render: (p) => DPP.formatNumber(p.company_count) },
        {
          label: "",
          className: "text-right col-actions",
          render: (p) =>
            el("button", {
              className: "btn btn-secondary btn-sm",
              text: "Bewerken",
              attrs: { type: "button" },
              on: {
                click: (event) => {
                  event.stopPropagation();
                  openPlanModal(p);
                }
              }
            })
        }
      ]
    });
  }

  async function load() {
    try {
      plans = await api.get("/api/admin/plans");
    } catch (error) {
      DPP.showError(error);
      plans = [];
    }
    render();
  }

  function activeCheckbox(checked) {
    const id = `plan-active-${Math.random().toString(36).slice(2, 8)}`;
    const input = el("input", { attrs: { type: "checkbox", id, name: "isActive" } });
    input.checked = checked;
    return el(
      "div",
      { className: "form-field full" },
      el("label", { className: "checkbox-label", attrs: { for: id } }, input, el("span", { text: "Actief (kiesbaar voor bedrijven)" }))
    );
  }

  function openPlanModal(plan) {
    const editing = Boolean(plan);
    A.formModal({
      title: editing ? `Plan bewerken: ${plan.name}` : "Nieuw plan",
      submitLabel: editing ? "Opslaan" : "Plan aanmaken",
      intro:
        editing && plan.company_count > 0
          ? `Dit plan wordt gebruikt door ${plan.company_count} bedrijf${plan.company_count === 1 ? "" : "en"}. Een lagere gebruikerslimiet geldt direct voor bedrijven zonder eigen limiet.`
          : undefined,
      fields: [
        { name: "name", label: "Naam", required: true, full: true, maxlength: 100, value: plan && plan.name },
        { name: "description", label: "Beschrijving", type: "textarea", rows: 2, full: true, maxlength: 500, value: plan && plan.description },
        { name: "maxUsers", label: "Max. gebruikers", type: "number", required: true, min: 0, max: 1000000, value: plan ? plan.max_users : 5 },
        { name: "maxProducts", label: "Richtlijn producten", type: "number", required: true, min: 0, max: 10000000, value: plan ? plan.max_products : 100, help: "Informatief: wordt (nog) niet afgedwongen bij het aanmaken van producten." },
        activeCheckbox(plan ? Boolean(plan.is_active) : true)
      ],
      onSubmit: async (data, form, close) => {
        const body = {
          name: data.name,
          // "" = beschrijving leegmaken (de backend maakt er NULL van).
          description: A.textValue(form, "description"),
          maxUsers: data.maxUsers,
          maxProducts: data.maxProducts,
          isActive: data.isActive
        };
        if (editing) await api.patch(`/api/admin/plans/${encodeURIComponent(plan.id)}`, body);
        else await api.post("/api/admin/plans", body);
        close();
        DPP.showSuccess(editing ? "Plan opgeslagen." : "Plan aangemaakt.");
        await load();
      }
    });
  }

  await load();
});
