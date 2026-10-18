const { getPool } = require("../config/db");
const productsRepo = require("./products.repository");

// Batch- en itempaspoorten. Elke batch en elk exemplaar heeft een eigen permanente
// public_id (eigen QR-code); de productgegevens komen van het modelpaspoort.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_COLUMNS = "i.id, i.product_id, i.batch_id, i.serial_number, i.public_id, i.status, i.created_at, b.batch_number";

// Een paspoort-id → { product (openbare rij), instance } of null. instance is null voor
// een modelpaspoort. Het product moet openbaar zijn (gepubliceerd of ooit gepubliceerd).
async function resolvePublicPassport(publicId) {
  if (!UUID.test(String(publicId || ""))) return null;
  const pool = await getPool();
  const ref = (await pool.query("SELECT product_id, granularity, batch_id, item_id FROM dbo.passportids WHERE public_id = $1", [
    String(publicId).toLowerCase()
  ])).rows[0];
  if (!ref) return null;
  const productRow = (await pool.query("SELECT public_id FROM dbo.products WHERE id = $1", [ref.product_id])).rows[0];
  const product = productRow ? await productsRepo.getProductByPublicId(String(productRow.public_id)) : null;
  if (!product) return null;
  if (ref.granularity === "model") return { product, instance: null };
  if (ref.granularity === "batch") {
    const batch = (await pool.query("SELECT batch_number, production_date FROM dbo.productbatches WHERE id = $1", [ref.batch_id])).rows[0];
    return {
      product,
      instance: {
        granularity: "batch",
        publicId: String(publicId).toLowerCase(),
        lotNumber: batch?.batch_number ?? null,
        productionDate: batch?.production_date ?? null
      }
    };
  }
  const item = (await pool.query(
    `SELECT i.serial_number, i.status, b.batch_number, b.production_date
     FROM dbo.productitems i LEFT JOIN dbo.productbatches b ON b.id = i.batch_id WHERE i.id = $1`,
    [ref.item_id]
  )).rows[0];
  return {
    product,
    instance: {
      granularity: "item",
      publicId: String(publicId).toLowerCase(),
      serialNumber: item?.serial_number ?? null,
      lotNumber: item?.batch_number ?? null,
      productionDate: item?.production_date ?? null,
      itemStatus: item?.status ?? "active"
    }
  };
}

// GS1 Digital Link → paspoort-id: /01/{gtin}[/10/{lot}][/21/{serial}]. Meest specifiek wint:
// serienummer → itempaspoort, lot → batchpaspoort, anders het modelpaspoort.
async function findByGs1({ gtin14, lot = null, serial = null }) {
  const pool = await getPool();
  const product = (await pool.query(
    `SELECT id, public_id FROM dbo.products
     WHERE gtin IS NOT NULL AND public_id IS NOT NULL AND published_at IS NOT NULL AND status IN ('published','archived')
       AND lpad(regexp_replace(gtin, '[^0-9]', '', 'g'), 14, '0') = $1
     ORDER BY (status = 'published') DESC, published_at DESC LIMIT 1`,
    [gtin14]
  )).rows[0];
  if (!product) return null;
  if (serial) {
    const item = (await pool.query("SELECT public_id FROM dbo.productitems WHERE product_id = $1 AND serial_number = $2", [product.id, serial])).rows[0];
    if (item) return String(item.public_id);
  }
  if (lot) {
    const batch = (await pool.query("SELECT public_id FROM dbo.productbatches WHERE product_id = $1 AND batch_number = $2 ORDER BY id DESC LIMIT 1", [product.id, lot])).rows[0];
    if (batch) return String(batch.public_id);
  }
  return String(product.public_id);
}

async function listItems(productId, { page = 1, pageSize = 50 } = {}) {
  const pool = await getPool();
  const total = Number((await pool.query("SELECT COUNT(*) FROM dbo.productitems WHERE product_id = $1", [productId])).rows[0].count);
  const rows = (await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM dbo.productitems i LEFT JOIN dbo.productbatches b ON b.id = i.batch_id
     WHERE i.product_id = $1 ORDER BY i.id DESC LIMIT $2 OFFSET $3`,
    [productId, pageSize, (page - 1) * pageSize]
  )).rows;
  return { items: rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Bestaande serienummers worden overgeslagen (idempotent); terug: de nieuw gemaakte items
// en de serienummers die al bestonden.
async function createItems({ productId, companyId, batchId = null, serials }) {
  const pool = await getPool();
  const rows = (await pool.query(
    `INSERT INTO dbo.productitems (product_id, company_id, batch_id, serial_number)
     SELECT $1, $2, $3, s FROM unnest($4::text[]) AS s
     ON CONFLICT (product_id, serial_number) DO NOTHING
     RETURNING id, serial_number, public_id`,
    [productId, companyId, batchId, serials]
  )).rows;
  const made = new Set(rows.map((r) => r.serial_number));
  return { created: rows, skipped: serials.filter((s) => !made.has(s)) };
}

async function setItemStatus(productId, itemId, status) {
  const pool = await getPool();
  return (await pool.query(
    "UPDATE dbo.productitems SET status = $3 WHERE id = $2 AND product_id = $1 RETURNING id, serial_number, public_id, status",
    [productId, itemId, status]
  )).rows[0] || null;
}

async function exportItems(productId) {
  const pool = await getPool();
  return (await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM dbo.productitems i LEFT JOIN dbo.productbatches b ON b.id = i.batch_id
     WHERE i.product_id = $1 ORDER BY i.id`,
    [productId]
  )).rows;
}

// Batch- en item-id's van een product (voor het verversen van de rand-cache), begrensd.
async function instancePublicIds(productIds, limit = 500) {
  if (!productIds.length) return [];
  const pool = await getPool();
  return (await pool.query(
    `SELECT public_id FROM (
       SELECT public_id, created_at FROM dbo.productbatches WHERE product_id = ANY($1::int[])
       UNION ALL
       SELECT public_id, created_at FROM dbo.productitems WHERE product_id = ANY($1::int[])
     ) x ORDER BY created_at DESC LIMIT $2`,
    [productIds, limit]
  )).rows.map((r) => String(r.public_id));
}

module.exports = { resolvePublicPassport, findByGs1, listItems, createItems, setItemStatus, exportItems, instancePublicIds };
