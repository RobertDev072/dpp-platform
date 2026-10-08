const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getPool, sql } = require("../config/db");
const { isPlatformOwner, isPartnerAdmin } = require("../utils/roles");

// Globale zoekfunctie. Het zoekbereik volgt de rol en komt uit de sessie:
// - klantgebruikers: producten (naam/SKU/GTIN/QR-id) en documenten van het eigen
//   bedrijf; collega's alleen voor de Bedrijfsbeheerder;
// - partner: alleen de eigen klantbedrijven;
// - Platform Owner: bedrijven, gebruikers en producten over het hele platform.
const router = express.Router();
const LIMIT = 6;

function escapeLike(value) {
  return value.replace(/[\\%_\[]/g, (m) => `\\${m}`);
}

async function query(text, inputs) {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(inputs)) request.input(name, sql.NVarChar(220), value);
  return (await request.query(text)).recordset;
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const raw = String(req.query.q || "").trim().slice(0, 100);
    if (raw.length < 2) {
      res.json({ q: raw, groups: [] });
      return;
    }
    const like = `%${escapeLike(raw)}%`;
    // Een (deel van een) QR-link of public_id herkennen.
    const uuidPart = (raw.match(/[0-9a-f-]{8,36}/i) || [""])[0].toLowerCase();
    const user = req.user;
    const groups = [];

    if (isPlatformOwner(user.role)) {
      const [companies, users, products] = await Promise.all([
        query(
          `SELECT id, name, kind, status FROM dbo.Companies WHERE name ILIKE @q ESCAPE '\\' OR slug ILIKE @q ESCAPE '\\' ORDER BY name LIMIT ${LIMIT}`,
          { q: like }
        ),
        query(
          `SELECT u.id, u.email, u.first_name, u.last_name, u.role, c.name AS company_name
           FROM dbo.Users u LEFT JOIN dbo.Companies c ON c.id = u.company_id
           WHERE u.status <> 'deleted' AND (u.email ILIKE @q ESCAPE '\\' OR (coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) ILIKE @q ESCAPE '\\')
           ORDER BY u.email LIMIT ${LIMIT}`,
          { q: like }
        ),
        query(
          `SELECT p.id, p.name, p.sku, p.status, c.name AS company_name FROM dbo.Products p JOIN dbo.Companies c ON c.id = p.company_id
           WHERE p.name ILIKE @q ESCAPE '\\' OR p.sku ILIKE @q ESCAPE '\\' OR p.gtin ILIKE @q ESCAPE '\\'
           ORDER BY p.name LIMIT ${LIMIT}`,
          { q: like }
        )
      ]);
      groups.push({
        type: "companies",
        label: "Bedrijven",
        items: companies.map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: c.kind === "partner" ? "Partner" : "Klantbedrijf",
          href: c.kind === "partner" ? `/admin/partners?q=${encodeURIComponent(c.name)}` : `/admin/companies/${c.id}`
        }))
      });
      groups.push({
        type: "users",
        label: "Gebruikers",
        items: users.map((u) => ({
          id: u.id,
          title: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
          subtitle: [u.email, u.company_name].filter(Boolean).join(" · "),
          href: `/admin/users?q=${encodeURIComponent(u.email)}`
        }))
      });
      groups.push({
        type: "products",
        label: "Producten",
        items: products.map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: [p.sku, p.company_name].filter(Boolean).join(" · "),
          href: `/admin/products?q=${encodeURIComponent(p.sku || p.name)}`
        }))
      });
    } else if (isPartnerAdmin(user.role)) {
      const pool = await getPool();
      const customers = (
        await pool
          .request()
          .input("q", sql.NVarChar(220), like)
          .input("partnerId", sql.Int, user.companyId)
          .query(`SELECT id, name, status FROM dbo.Companies WHERE partner_id = @partnerId AND name ILIKE @q ESCAPE '\\' ORDER BY name LIMIT ${LIMIT}`)
      ).recordset;
      groups.push({
        type: "companies",
        label: "Klanten",
        items: customers.map((c) => ({ id: c.id, title: c.name, subtitle: c.status === "active" ? "Actief" : c.status, href: `/partner/klanten/${c.id}` }))
      });
    } else if (user.companyId != null) {
      const pool = await getPool();
      const scoped = () => pool.request().input("q", sql.NVarChar(220), like).input("companyId", sql.Int, user.companyId);
      const productWhere = uuidPart.length >= 8 ? "OR p.public_id::text ILIKE @uuid" : "";
      const productRequest = scoped();
      if (productWhere) productRequest.input("uuid", sql.NVarChar(60), `%${uuidPart}%`);
      const [products, documents, users] = await Promise.all([
        productRequest.query(`
          SELECT p.id, p.name, p.sku, p.gtin, p.status FROM dbo.Products p
          WHERE p.company_id = @companyId
            AND (p.name ILIKE @q ESCAPE '\\' OR p.sku ILIKE @q ESCAPE '\\' OR p.gtin ILIKE @q ESCAPE '\\' OR p.brand ILIKE @q ESCAPE '\\' ${productWhere})
          ORDER BY (p.status = 'archived'), p.name LIMIT ${LIMIT}`),
        scoped().query(`
          SELECT d.id, d.title, d.product_id, p.name AS product_name FROM dbo.Documents d JOIN dbo.Products p ON p.id = d.product_id
          WHERE d.company_id = @companyId AND (d.title ILIKE @q ESCAPE '\\')
          ORDER BY d.created_at DESC LIMIT ${LIMIT}`),
        user.role === "company_admin"
          ? scoped().query(`
              SELECT id, email, first_name, last_name, role FROM dbo.Users
              WHERE company_id = @companyId AND status <> 'deleted'
                AND (email ILIKE @q ESCAPE '\\' OR (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ILIKE @q ESCAPE '\\')
              ORDER BY email LIMIT ${LIMIT}`)
          : { recordset: [] }
      ]);
      const STATUS = { draft: "Concept", published: "Gepubliceerd", archived: "Gearchiveerd" };
      groups.push({
        type: "products",
        label: "Producten",
        items: products.recordset.map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: [p.sku && `SKU ${p.sku}`, p.gtin && `GTIN ${p.gtin}`, STATUS[p.status]].filter(Boolean).join(" · "),
          href: `/company/products/${p.id}`
        }))
      });
      groups.push({
        type: "documents",
        label: "Documenten",
        items: documents.recordset.map((d) => ({ id: d.id, title: d.title, subtitle: d.product_name, href: `/company/products/${d.product_id}?tab=documents` }))
      });
      if (user.role === "company_admin") {
        groups.push({
          type: "users",
          label: "Medewerkers",
          items: users.recordset.map((u) => ({
            id: u.id,
            title: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
            subtitle: u.email,
            href: "/company/organisatie"
          }))
        });
      }
    }

    res.json({ q: raw, groups: groups.filter((g) => g.items.length) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
