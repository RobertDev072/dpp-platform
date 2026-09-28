// Activatie van een Company Admin-uitnodiging. Het token staat in het URL-fragment
// (#token=...): dat stuurt de browser nooit naar een server. We lezen het één keer, wissen
// het direct uit de adresbalk en bewaren het alleen in deze closure — nooit in de DOM,
// localStorage of een URL. Het gaat uitsluitend in de POST-body naar de API.
(function () {
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  // Leest het token uit het fragment en wist de adresbalk direct. Altijd wissen, ook bij
  // een verminkte link: niets van het fragment hoort in de geschiedenis of een bladwijzer.
  function consumeFragment() {
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    const candidate = new URLSearchParams(hash).get("token");
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    return candidate && TOKEN_PATTERN.test(candidate) ? candidate : null;
  }

  let token = consumeFragment();

  const $ = (id) => document.getElementById(id);
  const sections = ["activate-loading", "activate-invalid", "activate-form-section", "activate-success"];

  function show(id) {
    for (const section of sections) $(section).classList.toggle("hidden", section !== id);
  }

  function showAlert(message) {
    const box = $("activate-alert");
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!message) return;
    const alert = document.createElement("div");
    alert.className = "alert alert-error";
    const text = document.createElement("span");
    text.textContent = message;
    alert.appendChild(text);
    box.appendChild(alert);
  }

  function formatDateTime(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleString("nl-NL", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // Zelfde regels als invitePasswordSchema op de backend (en de Entra-complexiteitseisen).
  const RULES = {
    length: (pw) => pw.length >= 12,
    upper: (pw) => /[A-Z]/.test(pw),
    lower: (pw) => /[a-z]/.test(pw),
    digit: (pw) => /[0-9]/.test(pw),
    symbol: (pw) => /[^A-Za-z0-9]/.test(pw),
    ascii: (pw) => /^[\x20-\x7E]*$/.test(pw)
  };

  function evaluate() {
    const pw = $("password").value;
    const confirm = $("password-confirm").value;
    let allOk = true;
    for (const item of document.querySelectorAll("#password-rules li")) {
      const rule = item.dataset.rule;
      const ok = rule === "match" ? pw.length > 0 && pw === confirm : RULES[rule](pw);
      item.classList.toggle("ok", ok);
      if (rule === "ascii") item.classList.toggle("hidden", ok);
      allOk = allOk && ok;
    }
    $("activate-submit").disabled = !allOk || pw.length > 256;
    return allOk;
  }

  function fillInvite(invite) {
    $("invite-company").textContent = invite.companyName || "—";
    $("invite-email").textContent = invite.email || "—";
    $("invite-expires").textContent = formatDateTime(invite.expiresAt);
    $("username").value = invite.email || "";
    if (invite.firstName) $("first-name").value = invite.firstName;
    if (invite.lastName) $("last-name").value = invite.lastName;
    if (invite.mode !== "entra") {
      // Lokale ontwikkelmodus: geen Entra, dus ook geen MFA-stap bij de eerste login.
      $("success-mfa").querySelector("span").textContent =
        "In de productieomgeving stel je bij je eerste login tweestapsverificatie (MFA) in. In deze lokale omgeving log je alleen met e-mail en wachtwoord in.";
    }
  }

  async function lookup() {
    if (!token) {
      show("activate-invalid");
      return;
    }
    try {
      const invite = await apiRequest("POST", "/api/invitations/lookup", { token });
      fillInvite(invite);
      show("activate-form-section");
      ($("first-name").value ? $("password") : $("first-name")).focus();
    } catch (error) {
      if (error.status === 429) {
        show("activate-form-section");
        $("activate-form").classList.add("hidden");
        document.querySelector(".invite-summary").classList.add("hidden");
        showAlert("Te veel pogingen. Wacht een kwartier en open de link opnieuw.");
        return;
      }
      token = null;
      show("activate-invalid");
    }
  }

  function messageFor(error) {
    switch (error.code) {
      case "LICENSE_LIMIT_REACHED":
        return "Het maximale aantal gebruikers voor dit bedrijf is bereikt. Neem contact op met de beheerder van het DPP Platform.";
      case "EMAIL_IN_USE":
        return "Er bestaat al een account met dit e-mailadres. Log in of neem contact op met de beheerder van het DPP Platform.";
      case "IDENTITY_PROVIDER_ERROR":
        return "Je account kon nu niet worden aangemaakt. Probeer het over enkele minuten opnieuw.";
      case "IDENTITY_PROVIDER_NOT_CONFIGURED":
        // Platform half ingericht (Entra-login wel, Graph nog niet); de link blijft geldig.
        return "Activeren is op dit moment nog niet mogelijk. Je link blijft geldig: probeer het later opnieuw of neem contact op met de beheerder van het DPP Platform.";
      case "RATE_LIMITED":
        return "Te veel pogingen. Wacht een kwartier en probeer het opnieuw.";
      default:
        break;
    }
    const fieldErrors = error.details && error.details.fieldErrors;
    if (fieldErrors) {
      const messages = Object.values(fieldErrors).flat().filter(Boolean);
      if (messages.length) return messages.join(" ");
    }
    return error.message || "Activeren is niet gelukt. Probeer het opnieuw.";
  }

  $("password").addEventListener("input", evaluate);
  $("password-confirm").addEventListener("input", evaluate);

  $("activate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(null);
    if (!evaluate() || !token) return;

    const button = $("activate-submit");
    button.disabled = true;
    button.textContent = "Account wordt geactiveerd…";
    try {
      const result = await apiRequest("POST", "/api/invitations/accept", {
        token,
        password: $("password").value,
        firstName: $("first-name").value.trim() || undefined,
        lastName: $("last-name").value.trim() || undefined
      });
      // Token en wachtwoord zijn na gebruik niet meer nodig: direct vergeten.
      token = null;
      $("password").value = "";
      $("password-confirm").value = "";
      $("success-email").textContent = (result && result.email) || $("invite-email").textContent;
      show("activate-success");
      $("to-login").focus();
    } catch (error) {
      if (error.code === "INVITE_INVALID" || error.status === 404) {
        token = null;
        show("activate-invalid");
        return;
      }
      showAlert(messageFor(error));
      button.textContent = "Account activeren";
      evaluate();
    }
  });

  // Een nieuwe link plakken in een al geopende activatiepagina laadt de pagina niet
  // opnieuw (alleen het fragment wijzigt): dan hier opnieuw uitlezen en wissen.
  window.addEventListener("hashchange", () => {
    if (!window.location.hash) return;
    token = consumeFragment();
    showAlert(null);
    $("activate-form").reset();
    $("activate-form").classList.remove("hidden");
    document.querySelector(".invite-summary").classList.remove("hidden");
    evaluate();
    show("activate-loading");
    lookup();
  });

  lookup();
})();
