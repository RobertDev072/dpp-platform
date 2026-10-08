const { getPool, sql } = require("../config/db");

const COLUMNS = "id, company_id, name, description, is_default, settings, created_by, created_at, updated_at";

// Alle functies zijn tenant-gebonden: een profiel-id van een ander bedrijf bestaat niet.

async function listProfiles(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query(`SELECT ${COLUMNS} FROM dbo.PrintProfiles WHERE company_id = @companyId ORDER BY is_default DESC, name`);
  return result.recordset;
}

async function getProfile(id, companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .query(`SELECT ${COLUMNS} FROM dbo.PrintProfiles WHERE id = @id AND company_id = @companyId`);
  return result.recordset[0] || null;
}

async function countProfiles(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("companyId", sql.Int, companyId)
    .query("SELECT COUNT(*) AS n FROM dbo.PrintProfiles WHERE company_id = @companyId");
  return result.recordset[0].n;
}

// Standaardprofiel wisselen en opslaan in één transactie (de unieke index staat
// maar één standaard per bedrijf toe).
async function saveProfile({ id, companyId, name, description, isDefault, settings, createdBy }) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isDefault) {
      await client.query(
        "UPDATE dbo.PrintProfiles SET is_default = false WHERE company_id = $1 AND is_default AND id <> COALESCE($2, -1)",
        [companyId, id ?? null]
      );
    }
    let result;
    if (id) {
      result = await client.query(
        `UPDATE dbo.PrintProfiles
         SET name = $3, description = $4, is_default = COALESCE($5, is_default), settings = $6::jsonb, updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING ${COLUMNS}`,
        [id, companyId, name, description ?? null, isDefault ?? null, JSON.stringify(settings)]
      );
    } else {
      result = await client.query(
        `INSERT INTO dbo.PrintProfiles (company_id, name, description, is_default, settings, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING ${COLUMNS}`,
        [companyId, name, description ?? null, Boolean(isDefault), JSON.stringify(settings), createdBy]
      );
    }
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteProfile(id, companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .input("companyId", sql.Int, companyId)
    .query("DELETE FROM dbo.PrintProfiles WHERE id = @id AND company_id = @companyId RETURNING id");
  return result.recordset[0] || null;
}

module.exports = { listProfiles, getProfile, countProfiles, saveProfile, deleteProfile };
