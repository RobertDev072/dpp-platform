const { queryRows } = require("../config/db");

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
  const params = [];
  const where = [];
  const add = (clause, value) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (companyId != null) add("a.company_id = ?", companyId);
  if (action) add("a.action = ?", action);
  if (entityType) add("a.entity_type = ?", entityType);
  if (entityId) add("a.entity_id = ?", String(entityId));
  if (userId) add("a.user_id = ?", userId);
  if (from) add("a.timestamp >= ?", from);
  if (to) add("a.timestamp <= ?", to);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(pageSize, (page - 1) * pageSize);

  const rows = await queryRows(
    `
    SELECT a.id, a.company_id, a.user_id, a.impersonator_user_id, a.action,
           a.entity_type, a.entity_id, a.timestamp, a.metadata,
           u.email AS user_email,
           imp.email AS impersonator_email,
           c.name AS company_name,
           COUNT(*) OVER() AS total
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users imp ON imp.id = a.impersonator_user_id
    LEFT JOIN companies c ON c.id = a.company_id
    ${whereSql}
    ORDER BY a.timestamp DESC, a.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `,
    params
  );

  const total = rows.length ? rows[0].total : 0;
  const items = rows.map(({ total: _ignored, ...row }) => row);

  return { items, total, page, pageSize };
}

// Activiteitenoverzicht voor een partner: uitsluitend acties die door gebruikers
// van het partnerbedrijf zelf zijn uitgevoerd (klant aangemaakt, invite verstuurd,
// wachtwoord gereset). Bewust NIET de audit-logs van de klantbedrijven zelf -
// wat klanten met hun producten/gebruikers doen blijft voor de partner onzichtbaar.
async function listPartnerActivity(partnerCompanyId, { limit = 50 } = {}) {
  return queryRows(
    `
    SELECT a.id, a.company_id, a.action, a.entity_type, a.entity_id, a.metadata, a.timestamp,
           u.email AS actor_email,
           c.name AS company_name
    FROM audit_logs a
    JOIN users u ON u.id = a.user_id AND u.company_id = $1
    LEFT JOIN companies c ON c.id = a.company_id
    ORDER BY a.timestamp DESC, a.id DESC
    LIMIT $2
  `,
    [partnerCompanyId, Math.min(Math.max(limit, 1), 200)]
  );
}

module.exports = { listAuditLogs, listPartnerActivity };
