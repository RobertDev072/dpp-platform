const { getSupabaseAdmin, createEphemeralAuthClient, isSupabaseConfigured } = require("../config/supabase");

// Identity provider: Supabase Auth (vervangt Microsoft Entra External ID + Graph).
//
// Rolverdeling blijft hetzelfde als onder Entra:
// - Supabase Auth bewaart en controleert de wachtwoorden van gewone accounts;
// - VeriPasso's eigen users-tabel bepaalt rol, bedrijf en status, en onze eigen
//   httpOnly-sessiecookie bepaalt of iemand ingelogd is. Supabase-sessies/tokens
//   worden nergens gebruikt of bewaard (na de wachtwoordcontrole direct ingetrokken).
// - users.auth_user_id koppelt een DPP-account aan auth.users.id.
// Het Platform Owner-account is bewust een lokaal bcrypt-account (break-glass).

class IdentityError extends Error {
  constructor(code, message, { status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Effectief "voor altijd" geblokkeerd (Supabase kent geen permanente ban-vlag).
const BAN_FOREVER = "876000h";

function isIdentityProviderConfigured() {
  return isSupabaseConfigured();
}

function admin() {
  return getSupabaseAdmin().auth.admin;
}

// Vertaalt Supabase Auth-fouten naar onze eigen, stabiele codes. Nooit tokens of
// volledige responses loggen.
function toIdentityError(error, fallbackMessage) {
  const code = error?.code || "";
  const status = error?.status;
  if (code === "email_exists" || code === "user_already_exists" || /already been registered/i.test(error?.message || "")) {
    return new IdentityError("EMAIL_EXISTS", "Er bestaat al een account met dit e-mailadres.", { status });
  }
  if (code === "weak_password" || code === "same_password") {
    return new IdentityError(
      "WEAK_PASSWORD",
      "Dit wachtwoord voldoet niet aan de eisen. Gebruik minimaal 12 tekens met hoofdletters, kleine letters, cijfers en leestekens.",
      { status }
    );
  }
  if (code === "invalid_credentials" || code === "email_not_confirmed") {
    return new IdentityError("INVALID_CREDENTIALS", "Ongeldige inloggegevens", { status });
  }
  if (code === "user_banned") {
    return new IdentityError("INACTIVE", "Account is gedeactiveerd", { status });
  }
  if (code === "otp_expired" || code === "otp_disabled") {
    return new IdentityError("INVALID_CODE", "Ongeldige of verlopen code", { status });
  }
  if (code === "user_not_found") {
    return new IdentityError("USER_NOT_FOUND", "Account niet gevonden", { status });
  }
  if (status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return new IdentityError("RATE_LIMITED", "Te veel aanvragen. Probeer het over een paar minuten opnieuw.", { status: 429 });
  }
  console.error("Supabase Auth-fout:", fallbackMessage, "status=" + (status ?? "-"), "code=" + (code || "-"));
  const technischeCode = code || (status ? `HTTP ${status}` : "onbekend");
  return new IdentityError(
    "UNKNOWN",
    `${fallbackMessage} (code: ${technischeCode}). Probeer het opnieuw of meld deze code aan de beheerder.`,
    { status }
  );
}

// --- beheer (service role) -----------------------------------------------------

async function createAuthUser({ email, password, displayName }) {
  const { data, error } = await admin().createUser({
    email,
    password,
    // De beheerder (of de uitnodiging) staat in voor het adres; er wordt geen
    // bevestigingsmail verstuurd.
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : undefined
  });
  if (error) throw toIdentityError(error, "Account aanmaken bij Supabase Auth mislukt");
  return { authUserId: data.user.id };
}

async function setAccountEnabled(authUserId, enabled) {
  const { error } = await admin().updateUserById(authUserId, { ban_duration: enabled ? "none" : BAN_FOREVER });
  if (error) throw toIdentityError(error, "Account (de)activeren bij Supabase Auth mislukt");
}

async function setPassword(authUserId, password) {
  const { error } = await admin().updateUserById(authUserId, { password });
  if (error) throw toIdentityError(error, "Wachtwoord instellen bij Supabase Auth mislukt");
}

// Definitief verwijderen (status 'deleted' in DPP). Niet terug te draaien, net als
// het verwijderen van het Entra-account vroeger.
async function deleteAuthUser(authUserId) {
  const { error } = await admin().deleteUser(authUserId);
  if (error && error.status !== 404) throw toIdentityError(error, "Account verwijderen bij Supabase Auth mislukt");
}

// --- wachtwoordcontrole ----------------------------------------------------------

// Controleert e-mail + wachtwoord bij Supabase Auth. Geeft de auth_user_id terug,
// of gooit IdentityError. De tijdelijke Supabase-sessie die hierbij ontstaat wordt
// direct weer ingetrokken: VeriPasso gebruikt zijn eigen sessies.
async function verifyPassword(email, password) {
  const client = createEphemeralAuthClient();
  let result;
  try {
    result = await client.auth.signInWithPassword({ email, password });
  } catch (error) {
    throw new IdentityError("UNAVAILABLE", "Het duurt te lang om te verbinden. Probeer het over een moment opnieuw.");
  }
  if (result.error) throw toIdentityError(result.error, "Inloggen bij Supabase Auth mislukt");

  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return { authUserId: result.data.user.id };
}

// --- wachtwoord vergeten (e-mailcode) ----------------------------------------------

// Laat Supabase Auth een herstelmail sturen. Supabase meldt bewust niet of het adres
// bestaat. De mailtemplate "Reset Password" moet de code tonen ({{ .Token }}), zie
// docs/migratie-azure-naar-vercel-supabase.md.
async function startPasswordRecovery(email, { redirectTo } = {}) {
  const client = createEphemeralAuthClient();
  const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  if (error) throw toIdentityError(error, "Herstelcode versturen mislukt");
}

// Controleert de code uit de herstelmail; geeft de auth_user_id terug.
async function verifyRecoveryCode(email, code) {
  const client = createEphemeralAuthClient();
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (error) {
    const mapped = toIdentityError(error, "Code controleren mislukt");
    // Een foute code geeft bij Supabase een 403/otp_expired; altijd als ongeldige code tonen.
    if (mapped.code === "UNKNOWN" && (error.status === 403 || error.status === 400)) {
      throw new IdentityError("INVALID_CODE", "Ongeldige of verlopen code");
    }
    throw mapped;
  }
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return { authUserId: data.user.id };
}

module.exports = {
  IdentityError,
  isIdentityProviderConfigured,
  createAuthUser,
  setAccountEnabled,
  setPassword,
  deleteAuthUser,
  verifyPassword,
  startPasswordRecovery,
  verifyRecoveryCode
};
