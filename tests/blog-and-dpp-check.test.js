const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFrontmatter, getAllPosts, getPost, translationUrl, renderMarkdown } = require("../lib/blog");
const { CATEGORIES, BATTERY_TYPES, ROLES, evaluate } = require("../lib/dppCheck");

// Blog: elk artikel moet geldig zijn (anders faalt de build van de website), een bron
// hebben (geen wetgevingsclaims zonder bron) en een bestaande vertaling als die genoemd is.

test("frontmatter: velden, lijsten en duidelijke fout zonder frontmatter", () => {
  const { data, body } = parseFrontmatter("---\ntitle: Test\ntags: a, b\nsources:\n  - Bron | https://x.eu\n---\nTekst");
  assert.equal(data.title, "Test");
  assert.deepEqual(data.sources, ["Bron | https://x.eu"]);
  assert.equal(body, "Tekst");
  assert.throws(() => parseFrontmatter("geen frontmatter"), /frontmatter ontbreekt/);
});

for (const lang of ["nl", "en"]) {
  test(`alle ${lang}-artikelen zijn geldig, hebben bronnen en een werkende vertaling`, () => {
    const posts = getAllPosts(lang, { includeDrafts: true });
    assert.ok(posts.length > 0, "geen artikelen gevonden");
    for (const post of posts) {
      assert.ok(post.description.length <= 200, `${post.slug}: description te lang voor zoekresultaten`);
      assert.ok(post.sources.length > 0, `${post.slug}: bronvermelding ontbreekt`);
      for (const s of post.sources) assert.match(s.url || "", /^https:\/\//, `${post.slug}: bron zonder https-link`);
      if (post.translation) assert.ok(translationUrl(post), `${post.slug}: vertaling '${post.translation}' bestaat niet`);
      assert.match(renderMarkdown(post.body), /<h2|<p/);
    }
  });
}

test("onbekende of ongeldige slug geeft null", () => {
  assert.equal(getPost("nl", "bestaat-niet"), null);
  assert.equal(getPost("nl", "../package"), null);
  assert.equal(getPost("de", "wat-is-een-digitaal-productpaspoort"), null);
});

test("externe links openen in een nieuw tabblad zonder referrer", () => {
  const html = renderMarkdown("[EU](https://eur-lex.europa.eu) en [check](/dpp-check)");
  assert.match(html, /href="https:\/\/eur-lex.europa.eu" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<a href="\/dpp-check">check<\/a>/);
});

// DPP-check: elke combinatie geeft een uitkomst in beide talen.
test("DPP-check: batterijpaspoort verplicht vanaf 18 februari 2027 voor EV, LMT en industrieel > 2 kWh", () => {
  for (const batteryType of ["ev", "lmt", "industrial-large"]) {
    const r = evaluate({ category: "battery", batteryType, role: "manufacturer", sellsInEu: true }, "nl");
    assert.equal(r.level, "required");
    assert.equal(r.date, "2027-02-18");
    assert.match(r.title, /18 februari 2027/);
  }
  assert.equal(evaluate({ category: "battery", batteryType: "other", role: "importer", sellsInEu: true }).level, "none");
});

test("DPP-check: textiel is 'verwacht', niet verkopen in de EU is 'geen verplichting'", () => {
  assert.equal(evaluate({ category: "textile", role: "manufacturer", sellsInEu: true }, "en").level, "expected");
  assert.equal(evaluate({ category: "textile", role: "manufacturer", sellsInEu: false }).level, "none");
});

test("DPP-check: alle combinaties werken in NL en EN; ongeldige invoer geeft een fout", () => {
  for (const lang of ["nl", "en"]) for (const c of CATEGORIES) for (const r of ROLES) {
    const types = c.id === "battery" ? BATTERY_TYPES.map((b) => b.id) : [undefined];
    for (const batteryType of types) for (const sellsInEu of [true, false]) {
      const out = evaluate({ category: c.id, batteryType, role: r.id, sellsInEu }, lang);
      assert.ok(out.title && out.text && out.legal);
    }
  }
  assert.throws(() => evaluate({ category: "x", role: "manufacturer", sellsInEu: true }), /categorie/);
  assert.throws(() => evaluate({ category: "battery", role: "manufacturer", sellsInEu: true }), /batterijtype/);
});
