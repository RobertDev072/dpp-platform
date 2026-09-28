const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const introEl = document.getElementById("intro");
const formEl = document.getElementById("activate-form");
const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function init() {
  if (!token) {
    introEl.textContent = "Geen activatietoken gevonden. Vraag een nieuwe uitnodigingslink aan.";
    return;
  }

  let invite;
  try {
    invite = await apiRequest("GET", `/api/invites/${token}`);
  } catch (error) {
    introEl.textContent = "Deze uitnodiging is niet (meer) geldig.";
    return;
  }

  introEl.textContent = `Welkom bij ${invite.companyName || "DPP Platform"}. Activeer je account voor ${invite.email}.`;
  formEl.classList.remove("hidden");

  if (invite.requiresPassword) {
    document.getElementById("password-field").classList.remove("hidden");
    document.getElementById("password").required = true;
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");

  const passwordField = document.getElementById("password");
  const body = passwordField.value ? { password: passwordField.value } : {};

  try {
    await apiRequest("POST", `/api/invites/${token}/accept`, body);
    window.location.href = "/login.html";
  } catch (error) {
    showError(error.message);
  }
});

init();
