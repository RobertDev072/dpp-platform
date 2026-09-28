const { getPool, sql } = require("../config/db");

// Sleutels die nooit in een audit-log mogen belanden, ongeacht welke route logt.
// Bewust ruim: liever een onschuldig veld te veel weggefilterd dan een secret gelogd.
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|authorization|cookie|^code$|credential|hash/i;
const MAX_DEPTH = 4;

function sanitizeMetadata(value, depth = 0) {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item, depth + 1));
  }

  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    clean[key] = sanitizeMetadata(child, depth + 1);
  }
  return clean;
}

// Velden (spec -> kolom): actor_user_id -> user_id, target_type -> entity_type,
// target_id -> entity_id. De kolomnamen blijven zoals in 001_init.sql.
async function logAudit({ companyId, userId, action, entityType, entityId, metadata }) {
  try {
    const safeMetadata = metadata ? sanitizeMetadata(metadata) : null;
    const pool = await getPool();
    await pool
      .request()
      .input("companyId", sql.Int, companyId ?? null)
      .input("userId", sql.Int, userId ?? null)
      .input("action", sql.NVarChar(100), action)
      .input("entityType", sql.NVarChar(50), entityType)
      .input("entityId", sql.NVarChar(50), entityId != null ? String(entityId) : null)
      .input("metadata", sql.NVarChar(sql.MAX), safeMetadata ? JSON.stringify(safeMetadata) : null)
      .query(`
        INSERT INTO dbo.AuditLogs (company_id, user_id, action, entity_type, entity_id, metadata)
        VALUES (@companyId, @userId, @action, @entityType, @entityId, @metadata)
      `);
  } catch (error) {
    // Een audit-log die faalt mag de eigenlijke actie nooit blokkeren.
    console.error("Audit log mislukt:", error.message);
  }
}

module.exports = { logAudit, sanitizeMetadata };
