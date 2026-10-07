const { query } = require("../config/db");

async function logAudit({ companyId, userId, impersonatorUserId, action, entityType, entityId, metadata }) {
  try {
    await query(
      `
      INSERT INTO audit_logs (company_id, user_id, impersonator_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        companyId ?? null,
        userId ?? null,
        impersonatorUserId ?? null,
        action,
        entityType,
        entityId != null ? String(entityId) : null,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
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
