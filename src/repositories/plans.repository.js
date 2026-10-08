const { queryRows, queryOne } = require("../config/db");

const COLUMNS =
  "id, name, max_users, max_products, feature_flags, partner_assignable, price_monthly_cents, max_storage_mb, max_scans_month, created_at, updated_at";

// Geeft null terug als de company nog geen plan heeft (dan geldt geen limiet) — een
// platform owner kan een company aanmaken zonder meteen een plan te kiezen.
async function getMaxUsersForCompany(companyId) {
  const row = await queryOne(
    `
    SELECT p.max_users
    FROM companies c
    LEFT JOIN plans p ON p.id = c.plan_id
    WHERE c.id = $1
  `,
    [companyId]
  );
  return row ? row.max_users : null;
}

async function listPlans() {
  return queryRows(`SELECT ${COLUMNS} FROM plans ORDER BY name`);
}

async function getPlanById(id) {
  if (!Number.isInteger(id)) return null;
  return queryOne(`SELECT ${COLUMNS} FROM plans WHERE id = $1`, [id]);
}

async function createPlan({ name, maxUsers, maxProducts, featureFlags, partnerAssignable, priceMonthlyCents, maxStorageMb, maxScansMonth }) {
  return queryOne(
    `
    INSERT INTO plans (name, max_users, max_products, feature_flags, partner_assignable, price_monthly_cents, max_storage_mb, max_scans_month)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING ${COLUMNS}
  `,
    [name, maxUsers, maxProducts, featureFlags ?? null, partnerAssignable !== false, priceMonthlyCents ?? null, maxStorageMb ?? null, maxScansMonth ?? null]
  );
}

const UPDATABLE_FIELDS = ["name", "maxUsers", "maxProducts", "featureFlags", "partnerAssignable", "priceMonthlyCents", "maxStorageMb", "maxScansMonth"];
const FIELD_TO_COLUMN = {
  name: "name",
  maxUsers: "max_users",
  maxProducts: "max_products",
  partnerAssignable: "partner_assignable",
  featureFlags: "feature_flags",
  priceMonthlyCents: "price_monthly_cents",
  maxStorageMb: "max_storage_mb",
  maxScansMonth: "max_scans_month"
};

async function updatePlan(id, fields) {
  const params = [id];
  const setClauses = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in fields)) continue;
    params.push(field === "partnerAssignable" ? Boolean(fields[field]) : fields[field]);
    setClauses.push(`${FIELD_TO_COLUMN[field]} = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return getPlanById(id);
  }

  setClauses.push("updated_at = now()");

  return queryOne(`UPDATE plans SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${COLUMNS}`, params);
}

module.exports = {
  getMaxUsersForCompany,
  listPlans,
  getPlanById,
  createPlan,
  updatePlan
};
