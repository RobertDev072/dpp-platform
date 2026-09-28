// Loginpagina. Kiest via /api/auth/config tussen lokaal (e-mail + wachtwoord, alleen
// ontwikkeling) en Entra (stap 1: e-mail, daarna de beveiligde Entra-pagina in DPP-stijl).
// Geen dom.js/layout.js: die horen bij de app-shell en doen een auth-check met redirect.
// Al ingelogd? Dan stuurt de server GET /login.html zelf door (src/routes/home.routes.js);
// een /api/auth/me-check hier gaf elke anonieme bezoeker een 401 in de console.
(function () {
  // Vaste vertaling van de foutcodes die /auth/redirect meegeeft. De waarde uit de URL wordt
  // alleen als sleutel gebruikt en nooit zelf getoond.
  const ERROR_MESSAGES = {
    login_failed: "Inloggen is niet gelukt. Probeer het opnieuw.",
    no_account: "Er is geen DPP-account gekoppeld aan dit e-mailadres. Vraag je Company Admin om een account.",
    inactive: "Je account of je bedrijf is niet actief. Neem contact op met je Company Admin.",
    state: "Je inlogpoging is verlopen of ongeldig geworden. Probeer het opnieuw.",
    session: "Je bent niet (meer) ingelogd. Log in om verder te gaan."
  };

  const alertBox = document.getElementById("login-alert");
  const loading = document.getElementById("login-loading");
  const localForm = document.getElementById("local-form");
  const entraForm = document.getElementById("entra-form");
  const links = document.getElementById("auth-links");
  const forgotToggle = document.getElementById("forgot-toggle");
  const forgotHelp = document.getElementById("forgot-help");

  function homeFor(role) {
    return role === "system_owner" ? "/admin/index.html" : "/app/index.html";
  }

  function showAlert(message, kind) {
    while (alertBox.firstChild) alertBox.removeChild(alertBox.firstChild);
    if (!message) return;
    const box = document.createElement("div");
    box.className = `alert alert-${kind || "error"}`;
    const text = document.createElement("span");
    text.textContent = message;
    box.appendChild(text);
    alertBox.appendChild(box);
  }

  function showUrlError() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("error")) return;
    const code = params.get("error");
    showAlert(Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.login_failed);
    // Code uit de adresbalk halen: bij verversen of terugnavigeren niet opnieuw tonen.
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function getMode() {
    try {
      const response = await fetch("/api/auth/config", { credentials: "same-origin" });
      if (!response.ok) return "local";
      const config = await response.json();
      return config && config.mode === "entra" ? "entra" : "local";
    } catch {
      return "local";
    }
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.label;
  }

  function setupLocal() {
    localForm.classList.remove("hidden");
    document.getElementById("forgot-local").classList.remove("hidden");
    document.getElementById("local-email").focus();

    localForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      showAlert(null);
      const email = document.getElementById("local-email");
      const password = document.getElementById("local-password");
      if (!email.value.trim() || !password.value) {
        showAlert("Vul je e-mailadres en wachtwoord in.");
        return;
      }
      if (!email.checkValidity()) {
        showAlert("Vul een geldig e-mailadres in.");
        return;
      }

      setBusy(localForm, true, "Bezig met inloggen…");
      try {
        const result = await apiRequest("POST", "/api/auth/login", { email: email.value.trim(), password: password.value });
        // Alleen interne paden volgen (redirectTo komt van onze eigen API, maar toch).
        const target = result && typeof result.redirectTo === "string" && result.redirectTo.startsWith("/") && !result.redirectTo.startsWith("//")
          ? result.redirectTo
          : homeFor(result && result.role);
        window.location.href = target;
      } catch (error) {
        password.value = "";
        if (error.status === 429) {
          showAlert("Te veel inlogpogingen. Wacht een kwartier en probeer het opnieuw.");
        } else if (error.status === 401 || error.status === 400) {
          showAlert("Onjuist e-mailadres of wachtwoord, of je account is niet actief.");
        } else {
          showAlert("Inloggen is op dit moment niet mogelijk. Probeer het later opnieuw.");
        }
        setBusy(localForm, false);
        password.focus();
      }
    });
  }

  function setupEntra() {
    entraForm.classList.remove("hidden");
    document.getElementById("forgot-entra").classList.remove("hidden");
    const email = document.getElementById("entra-email");
    email.focus();

    entraForm.addEventListener("submit", (event) => {
      // "Doorgaan naar wachtwoord herstellen" (formnovalidate) mag ook zonder e-mailadres:
      // de backend start de Entra-flow dan zonder login_hint.
      const recovery = event.submitter && event.submitter.hasAttribute("formnovalidate");
      if (!recovery && !email.checkValidity()) {
        event.preventDefault();
        showAlert(email.value.trim() ? "Vul een geldig e-mailadres in." : "Vul je e-mailadres in.");
        email.focus();
        return;
      }
      showAlert(null);
      setBusy(entraForm, true, "Doorsturen…");
    });
  }

  forgotToggle.addEventListener("click", () => {
    const open = forgotHelp.classList.toggle("hidden") === false;
    forgotToggle.setAttribute("aria-expanded", String(open));
  });

  // Bij terugnavigeren (bfcache) de knoppen weer bruikbaar maken.
  window.addEventListener("pageshow", () => {
    setBusy(localForm, false);
    setBusy(entraForm, false);
  });

  (async function init() {
    showUrlError();
    const mode = await getMode();
    loading.classList.add("hidden");
    links.classList.remove("hidden");
    if (mode === "entra") setupEntra();
    else setupLocal();
  })();
})();
