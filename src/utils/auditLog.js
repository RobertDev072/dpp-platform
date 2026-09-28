const { getPool, sql } = require("../config/db");

async function logAudit({ companyId, userId, action, entityType, entityId, metadata }) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("companyId", sql.Int, companyId ?? null)
      .input("userId", sql.Int, userId ?? null)
      .input("action", sql.NVarChar(100), action)
      .input("entityType", sql.NVarChar(50), entityType)
      .input("entityId", sql.NVarChar(50), entityId != null ? String(entityId) : null)
      .input("metadata", sql.NVarChar(sql.MAX), metadata ? JSON.stringify(metadata) : null)
      .query(`
        INSERT INTO dbo.AuditLogs (company_id, user_id, action, entity_type, entity_id, metadata)
        VALUES (@companyId, @userId, @action, @entityType, @entityId, @metadata)
      `);
  } catch (error) {
    // Een audit-log die faalt mag de eigenlijke actie nooit blokkeren.
    console.error("Audit log mislukt:", error.message);
  }
}

module.exports = { logAudit };
