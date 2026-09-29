const { getPool, sql } = require("../config/db");

async function logAudit({ companyId, userId, impersonatorUserId, action, entityType, entityId, metadata }) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("companyId", sql.Int, companyId ?? null)
      .input("userId", sql.Int, userId ?? null)
      .input("impersonatorUserId", sql.Int, impersonatorUserId ?? null)
      .input("action", sql.NVarChar(100), action)
      .input("entityType", sql.NVarChar(50), entityType)
      .input("entityId", sql.NVarChar(50), entityId != null ? String(entityId) : null)
      .input("metadata", sql.NVarChar(sql.MAX), metadata ? JSON.stringify(metadata) : null)
      .query(`
        INSERT INTO dbo.AuditLogs (company_id, user_id, impersonator_user_id, action, entity_type, entity_id, metadata)
        VALUES (@companyId, @userId, @impersonatorUserId, @action, @entityType, @entityId, @metadata)
      `);
  } catch (error) {
    // Een audit-log die faalt mag de eigenlijke actie nooit blokkeren.
    console.error("Audit log mislukt:", error.message);
  }
}

// Schrijft de audit-regel vanuit een request: altijd de effectieve gebruiker, en -
// als er geïmpersoneerd wordt - ook wie er werkelijk achter de knoppen zit. Zo is
// elke actie tijdens impersonatie tot beide personen herleidbaar.
function logAuditFromReq(req, { companyId, action, entityType, entityId, metadata }) {
  return logAudit({
    companyId,
    userId: req.user?.id,
    impersonatorUserId: req.user?.impersonator?.id ?? null,
    action,
    entityType,
    entityId,
    metadata
  });
}

module.exports = { logAudit, logAuditFromReq };
