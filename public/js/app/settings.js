// Bedrijfsprofiel (company:settings). Naam, KvK, plan, licenties en status zijn alleen-lezen:
// die beheert platformbeheer (de backend weigert ze ook via .strict() in company.schema.js).
(function () {
  const DPP = window.DPP;
  const { el } = DPP;
  const A = DPP.app;

  // Bewerkbare velden: API-veld (camelCase) -> kolom in GET /api/company.
  const FIELDS = [
    { name: "address", column: "address", label: "Adres", type: "textarea", rows: 3, full: true, maxlength: 500, placeholder: "Straat en huisnummer\nPostcode en plaats" },
    { name: "country", column: "country", label: "Land", maxlength: 100, placeholder: "Nederland" },
    { name: "contactName", column: "contact_name", label: "Contactpersoon", maxlength: 200, autocomplete: "off" },
    {
      name: "contactEmail",
      column: "contact_email",
      label: "Contact e-mail",
      type: "email",
      full: true,
      maxlength: 256,
      autocomplete: "off",
      help: "Voor vragen van platformbeheer over licenties en facturatie. Wordt niet op publieke DPP-pagina's getoond."
    }
  ];

  DPP.initPage().then(async (user) => {
    if (!user) return;
    const content = document.getElementById("content");
    content.appendChild(DPP.pageHeader({ title: "Instellingen", subtitle: "Bedrijfsprofiel en contactgegevens." }));
    const body = el("div", null, A.loadingState());
    content.appendChild(body);

    let company;

    function seatsText(seats) {
      if (!seats || seats.maxUsers == null) return `${DPP.formatNumber(seats ? seats.activeUsers : 0)} actief · onbeperkt`;
      return `${DPP.formatNumber(seats.activeUsers)} van ${DPP.formatNumber(seats.maxUsers)} in gebruik`;
    }

    function profileCard() {
      const seats = company.seats || {};
      return el(
        "section",
        { className: "card" },
        el("div", { className: "card-header" }, el("h2", { text: "Bedrijfsprofiel" })),
        el("p", { className: "help-text", text: "Deze gegevens worden beheerd door platformbeheer. Klopt er iets niet, neem dan contact op met de beheerder van het DPP Platform." }),
        A.detailList(
          [
            ["Bedrijfsnaam", company.name],
            ["KvK-nummer", company.kvk_number],
            ["Plan", company.plan ? company.plan.name : "Geen plan"],
            ["Licenties", el("div", null, el("span", { text: seatsText(seats) }), A.seatsBar(seats.activeUsers || 0, seats.maxUsers))],
            ["Status", DPP.statusBadge(company.status)]
          ],
          "detail-list detail-compact"
        )
      );
    }

    function contactCard() {
      const errorBox = el("div", { className: "modal-error", attrs: { "aria-live": "polite" } });
      const form = el(
        "form",
        { className: "form-grid panel-form", attrs: { novalidate: true } },
        FIELDS.map((spec) => DPP.field({ ...spec, value: company[spec.column] ?? "" }))
      );
      const dirtyHint = el("span", { className: "dirty-hint" });
      const resetButton = el("button", { className: "btn btn-secondary", text: "Wijzigingen ongedaan maken", attrs: { type: "button", disabled: true } });
      const saveButton = el("button", { className: "btn", text: "Opslaan", attrs: { type: "submit", disabled: true } });
      form.appendChild(el("div", { className: "form-actions full" }, dirtyHint, resetButton, saveButton));

      form.addEventListener("input", () => {
        const dirty = Object.keys(A.changedFields(form, FIELDS, company)).length > 0;
        saveButton.disabled = !dirty;
        resetButton.disabled = !dirty;
        dirtyHint.textContent = dirty ? "Niet-opgeslagen wijzigingen" : "";
      });
      resetButton.addEventListener("click", render);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        DPP.clear(errorBox);
        A.clearFieldErrors(form);
        if (!form.reportValidity()) return;
        const changes = A.changedFields(form, FIELDS, company);
        if (Object.keys(changes).length === 0) return;
        await A.withBusy(saveButton, async () => {
          try {
            company = await api.patch("/api/company", changes);
            render();
            DPP.showSuccess("Bedrijfsgegevens opgeslagen.");
          } catch (error) {
            A.showFormError(errorBox, form, error);
          }
        });
      });

      return el(
        "section",
        { className: "card" },
        el("div", { className: "card-header" }, el("h2", { text: "Adres en contact" })),
        errorBox,
        form
      );
    }

    function render() {
      DPP.clear(body);
      body.appendChild(el("div", { className: "settings-columns" }, profileCard(), contactCard()));
    }

    try {
      company = await api.get("/api/company");
      render();
    } catch (error) {
      DPP.clear(body);
      body.appendChild(A.errorCard("Instellingen konden niet worden geladen", A.errorMessage(error)));
    }
  });
})();
