const { getPool, sql } = require("../config/db");

// Leest auditregels met filters + paginering. companyId null = alle bedrijven
// (alleen voor de Platform Owner - de route dwingt dat af).
async function listAuditLogs({
  companyId = null,
  action,
  entityType,
  entityId,
  userId,
  from,
  to,
  page = 1,
  pageSize = 25
}) {
  const pool = await getPool();
  const request = pool.request();

  const where = [];
  if (companyId != null) {
    where.push("a.company_id = @companyId");
    request.input("companyId", sql.Int, companyId);
  }
  if (action) {
    where.push("a.action = @action");
    request.input("action", sql.NVarChar(100), action);
  }
  if (entityType) {
    where.push("a.entity_type = @entityType");
    request.input("entityType", sql.NVarChar(50), entityType);
  }
  if (entityId) {
    where.push("a.entity_id = @entityId");
    request.input("entityId", sql.NVarChar(50), String(entityId));
  }
  if (userId) {
    where.push("a.user_id = @userId");
    request.input("userId", sql.Int, userId);
  }
  if (from) {
    where.push("a.timestamp >= @from");
    request.input("from", sql.DateTime2, from);
  }
  if (to) {
    where.push("a.timestamp <= @to");
    request.input("to", sql.DateTime2, to);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  request.input("offset", sql.Int, (page - 1) * pageSize);
  request.input("limit", sql.Int, pageSize);

  const result = await request.query(`
    SELECT a.id, a.company_id, a.user_id, a.impersonator_user_id, a.action,
           a.entity_type, a.entity_id, a.timestamp, a.metadata,
           u.email AS user_email,
           imp.email AS impersonator_email,
           c.name AS company_name,
           COUNT(*) OVER() AS total
    FROM dbo.AuditLogs a
    LEFT JOIN dbo.Users u ON u.id = a.user_id
    LEFT JOIN dbo.Users imp ON imp.id = a.impersonator_user_id
    LEFT JOIN dbo.Companies c ON c.id = a.company_id
    ${whereSql}
    ORDER BY a.timestamp DESC, a.id DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  const rows = result.recordset;
  const total = rows.length ? rows[0].total : 0;
  const items = rows.map(({ total: _ignored, ...row }) => row);

  return { items, total, page, pageSize };
}

module.exports = { listAuditLogs };
