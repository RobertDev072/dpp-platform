const { getPool } = require("../config/db");

// Scans per dag samenvatten en oude losse scanregels opruimen (dagelijks onderhoud).
//
// - Alle dagen tot en met (vandaag - 3) gaan naar dbo.scandaily (aantal + laatste scan
//   per product per dag). Drie dagen marge: gebundelde scans van de Cloudflare Worker
//   kunnen tot twee dagen na het scannen binnenkomen (edgeSync.routes.js).
// - Losse regels ouder dan RETENTION_DAYS verdwijnen, maar alleen als hun dag al is
//   samengevat. Statistieken lezen altijd via dbo.scandays, dus de cijfers veranderen
//   hierdoor niet.
// Idempotent en herstartbaar: een onderbroken run doet de volgende keer gewoon verder.

const LAG_DAYS = 3;
const RETENTION_DAYS = 90;
const DELETE_BATCH = 20_000;

async function rollupScans({ retentionDays = RETENTION_DAYS } = {}) {
  const pool = await getPool();
  const client = await pool.connect();
  let summarizedDays = 0;
  let through;
  try {
    await client.query("BEGIN");
    const state = await client.query("SELECT rolled_up_through::text AS d FROM dbo.scanrollup WHERE id = 1 FOR UPDATE");
    const target = await client.query(`SELECT ((now() AT TIME ZONE 'UTC')::date - $1::int)::text AS d`, [LAG_DAYS]);
    // Datums als tekst (JJJJ-MM-DD): geen tijdzoneverschuiving via JavaScript-Date.
    const from = state.rows[0].d;
    through = target.rows[0].d;
    if (through > from) {
      const result = await client.query(
        `INSERT INTO dbo.scandaily (product_id, day, scans, last_scan_at)
         SELECT product_id, (scanned_at AT TIME ZONE 'UTC')::date, COUNT(*), MAX(scanned_at)
         FROM dbo.scanevents
         WHERE scanned_at >= (($1::date + 1)::timestamp AT TIME ZONE 'UTC')
           AND scanned_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
         GROUP BY 1, 2
         ON CONFLICT (product_id, day) DO UPDATE SET scans = EXCLUDED.scans, last_scan_at = EXCLUDED.last_scan_at`,
        [from, through]
      );
      summarizedDays = result.rowCount;
      await client.query("UPDATE dbo.scanrollup SET rolled_up_through = $1 WHERE id = 1", [through]);
    } else {
      through = from;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Opruimen in porties: korte transacties, geen lange tabelvergrendeling.
  let deleted = 0;
  for (;;) {
    const result = await pool.query(
      `DELETE FROM dbo.scanevents WHERE id IN (
         SELECT id FROM dbo.scanevents
         WHERE scanned_at < now() - make_interval(days => $1::int)
           AND scanned_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
         LIMIT $3)`,
      [retentionDays, through, DELETE_BATCH]
    );
    deleted += result.rowCount;
    if (result.rowCount < DELETE_BATCH) break;
  }
  return { summarizedRows: summarizedDays, rolledUpThrough: through, deletedRawScans: deleted };
}

module.exports = { rollupScans, LAG_DAYS, RETENTION_DAYS };
