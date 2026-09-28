const { getPool, sql } = require("../config/db");

function parseMetadata(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Oude of handmatig ingevoerde rijen met ongeldige JSON mogen de lijst niet breken.
    return null;
  }
}

// AuditLogs.id is BIGINT; mssql geeft dat als string terug. Tot 2^53 is Number veilig.
function toAuditItem(row) {
  return {
    id: Number(row.id),
    timestamp: row.timestamp,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    company_id: row.company_id,
    company_name: row.company_name,
    user_id: row.user_id,
    actor_email: row.actor_email,
    metadata: parseMetadata(row.metadata)
  };
}

// Filters zijn allemaal optioneel en worden altijd als parameter meegegeven. companyId is
// hier een filter van de System Owner; tenant-scoped aanroepers geven req.user.companyId mee.
async function listAuditLogs({ companyId, action, entityType, limit = 50, offset = 0 } = {}) {
  const pool = await getPool();
  const request = pool.request().input("limit", sql.Int, limit).input("offset", sql.Int, offset);
  const where = [];

  if (companyId !== undefined) {
    request.input("companyId", sql.Int, companyId);
    where.push("a.company_id = @companyId");
  }
  if (action !== undefined) {
    request.input("action", sql.NVarChar(100), action);
    where.push("a.action = @action");
  }
  if (entityType !== undefined) {
    request.input("entityType", sql.NVarChar(50), entityType);
    where.push("a.entity_type = @entityType");
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await request.query(`
    SELECT a.id, a.timestamp, a.action, a.entity_type, a.entity_id, a.company_id, c.name AS company_name,
           a.user_id, u.email AS actor_email, a.metadata
    FROM dbo.AuditLogs a
    LEFT JOIN dbo.Companies c ON c.id = a.company_id
    LEFT JOIN dbo.Users u ON u.id = a.user_id
    ${whereSql}
    ORDER BY a.timestamp DESC, a.id DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;

    SELECT COUNT(*) AS total FROM dbo.AuditLogs a ${whereSql};
  `);

  return {
    items: result.recordsets[0].map(toAuditItem),
    total: result.recordsets[1][0].total
  };
}

module.exports = { listAuditLogs, parseMetadata };
