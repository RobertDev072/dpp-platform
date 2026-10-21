const crypto = require("crypto");
const { getPool } = require("../config/db");
const apiKeys = require("./apiKeys.service");

// Toegang per niveau tot machineleesbare paspoorten (ESPR art. 9/10-richting; voor
// batterijen Bijlage XIII van Verordening (EU) 2023/1542):
//   public        iedereen (consumenten), zonder token;
//   professional  reparateurs, recyclers en andere professionele partijen, met een token
//                 dat het bedrijf uitgeeft;
//   authority     markttoezicht, aangemelde instanties en de Commissie (ziet ook alles
//                 van "professional").
// Tokens: "vpa_" + 8 tekens prefix + "_" + 40 tekens geheim; alleen de SHA-256 wordt
// bewaard. Een token met company_id NULL (alleen door de Platform Owner) geldt voor alle
// bedrijven. Een geldig token voor een ander bedrijf geeft gewoon de publieke weergave.

const LEVELS = ["public", "professional", "authority"];
const TOKEN_PATTERN = /^vpa_([a-z0-9]{8})_([A-Za-z0-9]{40})$/;
const MAX_ACTIVE_TOKENS = 50;

function rank(level) {
  const index = LEVELS.indexOf(level);
  return index < 0 ? 0 : index;
}

// Mag een lezer met dit niveau het document zien? Openbaar altijd; een beperkt document
// alleen vanaf het ingestelde niveau; zonder niveau (intern) nooit via de publieke API.
function canSeeDocument(doc, level) {
  if (doc.isPublic) return true;
  if (!doc.accessLevel) return false;
  return rank(level) >= rank(doc.accessLevel);
}

function isAccessToken(value) {
  return /^vpa_/.test(String(value || ""));
}

function randomChars(length, alphabet) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const COLUMNS = "id, company_id, access_level, name, token_prefix, created_at, last_used_at, expires_at, revoked_at";

async function listTokens(companyId) {
  const pool = await getPool();
  return (await pool.query(
    `SELECT ${COLUMNS} FROM dbo.dppaccesstokens WHERE company_id IS NOT DISTINCT FROM $1 ORDER BY revoked_at NULLS FIRST, id DESC`,
    [companyId]
  )).rows;
}

async function createToken({ companyId, level, name, createdBy, expiresAt = null }) {
  if (!["professional", "authority"].includes(level)) throw Object.assign(new Error("Ongeldig toegangsniveau"), { statusCode: 400 });
  const pool = await getPool();
  const active = Number((await pool.query(
    `SELECT COUNT(*) FROM dbo.dppaccesstokens
     WHERE company_id IS NOT DISTINCT FROM $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [companyId]
  )).rows[0].count);
  if (active >= MAX_ACTIVE_TOKENS) {
    throw Object.assign(new Error(`Maximaal ${MAX_ACTIVE_TOKENS} actieve toegangstokens. Trek eerst een oud token in.`), { statusCode: 409 });
  }
  const prefix = randomChars(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  const token = `vpa_${prefix}_${randomChars(40, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")}`;
  const row = (await pool.query(
    `INSERT INTO dbo.dppaccesstokens (company_id, access_level, name, token_prefix, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
    [companyId, level, name, `vpa_${prefix}`, apiKeys.hashKey(token), createdBy ?? null, expiresAt]
  )).rows[0];
  return { ...row, token };
}

async function revokeToken(companyId, id) {
  const pool = await getPool();
  return (await pool.query(
    `UPDATE dbo.dppaccesstokens SET revoked_at = now()
     WHERE id = $1 AND company_id IS NOT DISTINCT FROM $2 AND revoked_at IS NULL RETURNING ${COLUMNS}`,
    [id, companyId]
  )).rows[0] || null;
}

// Geldig token → { tokenId, companyId (null = alle), level }; anders null.
async function authenticate(token) {
  if (!TOKEN_PATTERN.test(String(token || ""))) return null;
  const pool = await getPool();
  const row = (await pool.query(
    `SELECT t.id, t.company_id, t.access_level, t.last_used_at, c.status AS company_status
     FROM dbo.dppaccesstokens t LEFT JOIN dbo.companies c ON c.id = t.company_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [apiKeys.hashKey(token)]
  )).rows[0];
  if (!row || (row.company_id !== null && row.company_status !== "active")) return null;
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 5 * 60 * 1000) {
    await pool.query("UPDATE dbo.dppaccesstokens SET last_used_at = now() WHERE id = $1", [row.id]).catch(() => {});
  }
  return { tokenId: row.id, companyId: row.company_id, level: row.access_level };
}

// Niveau van deze lezer voor een paspoort van companyId. req.dppAccess komt uit de
// middleware (token); een API-sleutel van het eigen bedrijf telt als "authority".
function levelFor(req, companyId) {
  if (req.apiClient && Number(req.apiClient.companyId) === Number(companyId)) return "authority";
  const access = req.dppAccess;
  if (access && (access.companyId === null || Number(access.companyId) === Number(companyId))) return access.level;
  return "public";
}

// Opvraging met een token vastleggen (wie = het token, wat, wanneer). Alleen als het token
// voor dit paspoort meer gaf dan de publieke weergave. Nooit blokkerend: een fout in het
// logboek mag het opvragen niet breken.
function logAccess(req, product, { resource, documentId = null, publicId = null }) {
  const access = req.dppAccess;
  if (!access || levelFor(req, product.company_id) === "public") return;
  getPool()
    .then((pool) =>
      pool.query("INSERT INTO dbo.dppaccesslog (token_id, public_id, resource, document_id) VALUES ($1, $2, $3, $4)", [
        access.tokenId,
        String(publicId || product.instance?.publicId || product.public_id).toLowerCase(),
        resource,
        documentId
      ])
    )
    .catch(() => {});
}

async function accessLog(companyId, tokenId, limit = 100) {
  const pool = await getPool();
  return (await pool.query(
    `SELECT l.public_id, l.resource, l.document_id, l.accessed_at
     FROM dbo.dppaccesslog l JOIN dbo.dppaccesstokens t ON t.id = l.token_id
     WHERE l.token_id = $1 AND t.company_id IS NOT DISTINCT FROM $2
     ORDER BY l.accessed_at DESC LIMIT $3`,
    [tokenId, companyId, limit]
  )).rows;
}

module.exports = {
  LEVELS,
  rank,
  canSeeDocument,
  isAccessToken,
  listTokens,
  createToken,
  revokeToken,
  authenticate,
  levelFor,
  logAccess,
  accessLog,
  MAX_ACTIVE_TOKENS
};
