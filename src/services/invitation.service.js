const crypto = require("crypto");
const invitationsRepo = require("../repositories/invitations.repository");
const companiesRepo = require("../repositories/companies.repository");
const { getUserByEmail } = require("../repositories/users.repository");
const { getSeatUsage } = require("./seats.service");
const graphClient = require("./graphClient");
const { isEntraConfigured, isEntraLoginConfigured } = require("../config/entra");
const { hashPassword } = require("../utils/password");
const { getPublicBaseUrl } = require("../utils/publicUrl");
const { logAudit } = require("../utils/auditLog");
const { HttpError } = require("../middleware/errorHandler");

const INVITE_EXPIRY_HOURS = 72;

// Eén generieke melding voor elk onbruikbaar token (onbekend, verlopen, ingetrokken, al
// gebruikt, company gedeactiveerd): het verschil zou alleen een aanvaller helpen.
const INVITE_INVALID_MESSAGE = "Deze uitnodigingslink is ongeldig of verlopen";

function inviteInvalidError() {
  return new HttpError(404, INVITE_INVALID_MESSAGE, undefined, "INVITE_INVALID");
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// 32 random bytes; alleen de SHA-256 gaat de database in. Het token zelf bestaat alleen in
// de response van create/resend en daarna in de link die de System Owner deelt.
function generateInviteToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

// Token in het fragment (#): browsers sturen dat nooit mee naar de server, dus het belandt
// niet in access logs of Referer-headers. activate.html leest het en wist het direct.
function buildActivationUrl(req, token) {
  return `${getPublicBaseUrl(req)}/activate.html#token=${token}`;
}

// Alleen de velden uit het API-contract; token_hash komt sowieso nooit uit de repository.
function toInvitationResponse(invitation) {
  return {
    id: invitation.id,
    company_id: invitation.company_id,
    email: invitation.email,
    first_name: invitation.first_name,
    last_name: invitation.last_name,
    status: invitation.status,
    expires_at: invitation.expires_at,
    created_at: invitation.created_at
  };
}

async function assertCanInvite(companyId, email) {
  const company = await companiesRepo.getCompanyById(companyId);
  if (!company) {
    throw new HttpError(404, "Niet gevonden");
  }
  if (company.status !== "active") {
    throw new HttpError(409, "Dit bedrijf is niet actief", undefined, "COMPANY_INACTIVE");
  }
  if (await getUserByEmail(email)) {
    throw new HttpError(409, "E-mailadres is al in gebruik", undefined, "EMAIL_IN_USE");
  }
  return company;
}

async function createInvitation(req, companyId, { email, firstName, lastName }) {
  await assertCanInvite(companyId, email);

  const { token, tokenHash } = generateInviteToken();
  const invitation = await invitationsRepo.createInvitation({
    companyId,
    email,
    firstName,
    lastName,
    tokenHash,
    expiryHours: INVITE_EXPIRY_HOURS,
    createdBy: req.user.id
  });

  // Nooit het token of de link loggen: wie de audit log kan lezen, mag de invite niet kunnen gebruiken.
  await logAudit({
    companyId,
    userId: req.user.id,
    action: "invite_create",
    entityType: "CompanyInvitation",
    entityId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role }
  });

  return { invitation: toInvitationResponse(invitation), activationUrl: buildActivationUrl(req, token) };
}

async function resendInvitation(req, invitationId) {
  const existing = await invitationsRepo.getInvitationById(invitationId);
  if (!existing) {
    throw new HttpError(404, "Niet gevonden");
  }
  // Verlopen invites mogen juist opnieuw verstuurd worden; geaccepteerde/ingetrokken niet.
  if (existing.status !== "pending" && existing.status !== "expired") {
    throw new HttpError(409, "Deze uitnodiging staat niet meer open", undefined, "INVITE_NOT_PENDING");
  }
  await assertCanInvite(existing.company_id, existing.email);

  const { token, tokenHash } = generateInviteToken();
  const invitation = await invitationsRepo.resendInvitation(invitationId, {
    tokenHash,
    expiryHours: INVITE_EXPIRY_HOURS,
    createdBy: req.user.id
  });
  if (!invitation) {
    // Tussen de check en de update geaccepteerd of ingetrokken.
    throw new HttpError(409, "Deze uitnodiging staat niet meer open", undefined, "INVITE_NOT_PENDING");
  }

  await logAudit({
    companyId: invitation.company_id,
    userId: req.user.id,
    action: "invite_create",
    entityType: "CompanyInvitation",
    entityId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role, resend: true, replaces: invitationId }
  });

  return { invitation: toInvitationResponse(invitation), activationUrl: buildActivationUrl(req, token) };
}

async function revokeInvitation(req, invitationId) {
  const existing = await invitationsRepo.getInvitationById(invitationId);
  if (!existing) {
    throw new HttpError(404, "Niet gevonden");
  }
  if (existing.status !== "pending") {
    throw new HttpError(409, "Deze uitnodiging staat niet meer open", undefined, "INVITE_NOT_PENDING");
  }

  const revoked = await invitationsRepo.revokeInvitation(invitationId);
  if (!revoked) {
    throw new HttpError(409, "Deze uitnodiging staat niet meer open", undefined, "INVITE_NOT_PENDING");
  }

  await logAudit({
    companyId: revoked.company_id,
    userId: req.user.id,
    action: "invite_revoke",
    entityType: "CompanyInvitation",
    entityId: revoked.id,
    metadata: { email: revoked.email }
  });

  return revoked;
}

async function lookupInvitation(token) {
  const invite = await invitationsRepo.findValidInvitationByTokenHash(hashInviteToken(token));
  if (!invite) {
    throw inviteInvalidError();
  }

  return {
    companyName: invite.company_name,
    email: invite.email,
    firstName: invite.first_name,
    lastName: invite.last_name,
    expiresAt: invite.expires_at,
    mode: isEntraConfigured() ? "entra" : "local"
  };
}

// Best effort: een Entra-account zonder bijbehorende DPP-user mag niet bruikbaar blijven.
async function disableOrphanedEntraAccount(entraObjectId) {
  try {
    await graphClient.setAccountEnabled(entraObjectId, false);
  } catch (error) {
    // Alleen het object-id en de foutmelding; nooit wachtwoord of token.
    console.error(`Uitschakelen van Entra-account ${entraObjectId} na mislukte activatie mislukt:`, error.message);
  }
}

async function acceptInvitation({ token, password, firstName, lastName }) {
  const tokenHash = hashInviteToken(token);

  // Snelle pre-checks vóór een (lastig terug te draaien) Graph-call. De autoritatieve,
  // race-veilige checks zitten in de transactie van invitationsRepo.acceptInvitation.
  const invite = await invitationsRepo.findValidInvitationByTokenHash(tokenHash);
  if (!invite) {
    throw inviteInvalidError();
  }
  if (await getUserByEmail(invite.email)) {
    throw new HttpError(409, "E-mailadres is al in gebruik", undefined, "EMAIL_IN_USE");
  }
  const seats = await getSeatUsage(invite.company_id);
  if (seats && seats.maxUsers != null && seats.activeUsers >= seats.maxUsers) {
    throw new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED");
  }

  // Gefaseerde setup (alleen de login-vars, nog geen Graph): lokale login is dan dicht, dus
  // een lokaal wachtwoord zou een Company Admin opleveren die nergens kan inloggen, en de
  // invite zou verbruikt zijn. Fail closed (net als POST /api/users) tot Graph er is; de
  // invite blijft geldig tot de verloopdatum.
  if (isEntraLoginConfigured() && !isEntraConfigured()) {
    throw new HttpError(
      503,
      "Activeren kan pas als de Entra Graph-koppeling is geconfigureerd. Probeer het later opnieuw.",
      undefined,
      "IDENTITY_PROVIDER_NOT_CONFIGURED"
    );
  }

  const displayFirstName = firstName || invite.first_name || null;
  const displayLastName = lastName || invite.last_name || null;

  let entraObjectId = null;
  let passwordHash = null;

  if (isEntraConfigured()) {
    // De admin kiest het wachtwoord zelf, dus niet bij de eerste login laten wijzigen.
    // MFA volgt uit de Conditional Access-policy in Entra, niet uit deze flow.
    try {
      const displayName = [displayFirstName, displayLastName].filter(Boolean).join(" ") || invite.email;
      const created = await graphClient.createEntraUser({
        email: invite.email,
        displayName,
        tempPassword: password,
        forceChangePasswordNextSignIn: false
      });
      entraObjectId = created.entraObjectId;
    } catch (error) {
      console.error("Entra-account aanmaken bij activatie mislukt:", error.message);
      throw new HttpError(502, "Account aanmaken is mislukt, probeer het later opnieuw", undefined, "IDENTITY_PROVIDER_ERROR");
    }
  } else {
    passwordHash = await hashPassword(password);
  }

  let result;
  try {
    result = await invitationsRepo.acceptInvitation({
      tokenHash,
      passwordHash,
      entraObjectId,
      firstName: displayFirstName,
      lastName: displayLastName
    });
  } catch (error) {
    if (entraObjectId) await disableOrphanedEntraAccount(entraObjectId);
    throw error;
  }

  if (result.error) {
    if (entraObjectId) await disableOrphanedEntraAccount(entraObjectId);
    if (result.error === "LICENSE_LIMIT_REACHED") {
      throw new HttpError(409, "Licentielimiet bereikt voor dit bedrijf", undefined, "LICENSE_LIMIT_REACHED");
    }
    if (result.error === "EMAIL_IN_USE") {
      throw new HttpError(409, "E-mailadres is al in gebruik", undefined, "EMAIL_IN_USE");
    }
    throw inviteInvalidError();
  }

  const { user, invitation } = result;

  await logAudit({
    companyId: user.company_id,
    userId: user.id,
    action: "invite_accept",
    entityType: "CompanyInvitation",
    entityId: invitation.id,
    metadata: { role: user.role, via: entraObjectId ? "entra" : "local" }
  });

  // Geen automatische login: de nieuwe admin logt in via Entra, zodat MFA via Conditional
  // Access ook voor de allereerste sessie geldt.
  return { email: user.email, redirectTo: "/login.html" };
}

module.exports = {
  INVITE_EXPIRY_HOURS,
  inviteInvalidError,
  hashInviteToken,
  generateInviteToken,
  buildActivationUrl,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  lookupInvitation,
  acceptInvitation
};
