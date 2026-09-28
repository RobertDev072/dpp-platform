// Platformconfiguratie (alleen status, nooit secrets): GET /api/admin/settings geeft per
// onderdeel alleen aan óf iets geconfigureerd is. Wijzigen gebeurt via App Service-
// instellingen (env vars), niet via deze pagina.
DPP.initPage().then(async (user) => {
  if (!user) return;
  const { el } = DPP;
  const content = document.getElementById("content");

  content.appendChild(
    DPP.pageHeader({
      title: "Instellingen",
      subtitle: "Status van de platformconfiguratie. Waarden worden beheerd als omgevingsvariabelen in Azure App Service; secrets zijn hier nooit zichtbaar."
    })
  );

  let settings;
  try {
    settings = await api.get("/api/admin/settings");
  } catch (error) {
    DPP.showError(error);
    return;
  }

  const entraMode = settings.entraLoginConfigured;

  function statusRow({ label, ok, okText = "Geconfigureerd", notText = "Niet geconfigureerd", warn = true, value, mono = false, help }) {
    return el(
      "div",
      { className: "setting-row" },
      el(
        "div",
        { className: "setting-main" },
        el("div", { className: "setting-label", text: label }),
        help ? el("div", { className: "setting-help", text: help }) : null
      ),
      el(
        "div",
        { className: "setting-value" },
        value !== undefined ? el("span", { className: `setting-text${mono ? " mono" : ""}`, text: value }) : null,
        ok === undefined ? null : el("span", { className: `badge ${ok ? "badge-active" : warn ? "badge-review" : "badge-muted"}`, text: ok ? okText : notText })
      )
    );
  }

  function card(title, rows, footer) {
    return el("section", { className: "card" }, el("div", { className: "card-header" }, el("h2", { text: title })), el("div", { className: "setting-list" }, rows), footer || null);
  }

  content.appendChild(
    el(
      "div",
      { className: `alert ${entraMode ? "alert-success" : "alert-warning"}` },
      el(
        "span",
        {
          text: entraMode
            ? "Inloggen loopt via Entra External ID. Gebruikers zien de DPP-huisstijl via Company branding; MFA wordt afgedwongen met Conditional Access."
            : "Lokale inlogmodus actief (e-mail + bcrypt-wachtwoord). Dit is alleen bedoeld voor ontwikkeling; configureer Entra External ID voor productie."
        }
      )
    )
  );

  content.appendChild(
    el(
      "div",
      { className: "settings-grid" },
      card("Identiteit en inloggen", [
        statusRow({
          label: "Inlogmodus",
          value: entraMode ? "Entra External ID" : "Lokaal (ontwikkeling)"
        }),
        statusRow({
          label: "Entra-login (app-registratie Web)",
          ok: settings.entraLoginConfigured,
          help: "ENTRA_TENANT_NAME, ENTRA_TENANT_ID, ENTRA_WEB_CLIENT_ID/SECRET, redirect-URI's en COOKIE_SECRET."
        }),
        statusRow({
          label: "Microsoft Graph (gebruikers aanmaken)",
          ok: settings.entraGraphConfigured,
          help: "Nodig om Company Admins bij activatie en medewerkers bij aanmaken een Entra-account te geven. Zonder Graph en login werkt gebruikersbeheer in lokale modus."
        })
      ]),
      card("Publieke URL en netwerk", [
        statusRow({
          label: "Publieke basis-URL",
          value: settings.publicBaseUrl || "—",
          mono: true,
          ok: settings.publicBaseUrlConfigured,
          okText: "Ingesteld",
          notText: "Afgeleid uit verzoek",
          help: "Gebruikt in activatielinks, publieke DPP-pagina's en QR-codes. Stel PUBLIC_BASE_URL in voor productie, zodat QR-codes altijd naar het juiste domein wijzen."
        }),
        statusRow({
          label: "Achter reverse proxy (TRUST_PROXY)",
          ok: settings.trustProxy,
          okText: "Aan",
          notText: "Uit",
          warn: false,
          help: "Aan op Azure App Service, zodat rate limiting en https-detectie het echte client-verzoek zien."
        }),
        statusRow({ label: "Omgeving (NODE_ENV)", value: settings.nodeEnv || "niet ingesteld", mono: Boolean(settings.nodeEnv) })
      ]),
      card("Sessies en uitnodigingen", [
        statusRow({ label: "Sessieduur", value: `${settings.sessionHours} uur`, help: "Daarna moet opnieuw worden ingelogd. Deactiveren of blokkeren beëindigt sessies direct." }),
        statusRow({
          label: "Geldigheid activatielink",
          value: `${settings.inviteExpiryHours} uur`,
          help: "Links zijn eenmalig bruikbaar; alleen een hash van het token wordt opgeslagen."
        }),
        statusRow({ label: "E-mail versturen", value: "Niet in gebruik", help: "Activatielinks en tijdelijke wachtwoorden worden één keer getoond; deel ze zelf via een veilig kanaal." })
      ])
    )
  );

  content.appendChild(
    el(
      "section",
      { className: "card" },
      el("div", { className: "card-header" }, el("h2", { text: "Handleiding" })),
      el(
        "ul",
        { className: "guidance-list" },
        el("li", { text: "Entra External ID instellen (app-registraties, user flow, Company branding, Conditional Access voor MFA): zie docs/entra-external-id-setup.md in de repository." }),
        el("li", { text: "Rollen, permissies en API-contract: zie docs/architecture-roles.md." }),
        el("li", { text: "Secrets (client secrets, database-wachtwoord, COOKIE_SECRET) horen alleen in App Service-instellingen of Key Vault, nooit in code of in deze console." })
      )
    )
  );
});
