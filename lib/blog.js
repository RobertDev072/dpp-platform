// Blog op www.veripasso.com: artikelen als Markdown-bestanden in content/blog/{nl,en}/.
// De bestandsnaam is de slug. Bovenaan elk bestand staat frontmatter tussen "---":
//
//   title: Wat is een digitaal productpaspoort?
//   description: Korte samenvatting (zoekresultaat, max. ±160 tekens).
//   date: 2026-10-25
//   category: gids            (gids | nieuws)
//   tags: DPP, ESPR, Batterijen
//   translation: what-is-a-digital-product-passport   (slug van de vertaling, optioneel)
//   draft: false
//   sources:
//     - EUR-Lex: Verordening (EU) 2024/1781 | https://eur-lex.europa.eu/eli/reg/2024/1781/oj
//
// Nieuwe artikelen komen binnen via een pull request en gaan pas live na goedkeuring.
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const LANGS = ["nl", "en"];
const CONTENT_DIR = path.join(process.cwd(), "content", "blog");
const SITE_URL = "https://www.veripasso.com";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("frontmatter ontbreekt");
  const data = {};
  let listKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { data[listKey].push(item[1].trim()); continue; }
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`ongeldige regel: ${line}`);
    const [, key, value] = pair;
    if (value === "") { data[key] = []; listKey = key; } else { data[key] = value.trim(); listKey = null; }
  }
  return { data, body: match[2] };
}

function parseSource(entry) {
  const i = entry.lastIndexOf("|");
  if (i === -1) return { title: entry.trim(), url: null };
  return { title: entry.slice(0, i).trim(), url: entry.slice(i + 1).trim() };
}

function postUrl(lang, slug) {
  return lang === "nl" ? `/blog/${slug}` : `/en/blog/${slug}`;
}

// Leest en controleert één artikel. Gooit een duidelijke fout bij een ongeldig bestand,
// zodat een fout in een nieuw artikel de build (en dus de pull request) laat falen.
function readPost(lang, file) {
  const slug = file.replace(/\.md$/, "");
  const where = `content/blog/${lang}/${file}`;
  if (!SLUG_PATTERN.test(slug)) throw new Error(`${where}: bestandsnaam moet bestaan uit kleine letters, cijfers en streepjes`);
  let parsed;
  try { parsed = parseFrontmatter(fs.readFileSync(path.join(CONTENT_DIR, lang, file), "utf8")); }
  catch (e) { throw new Error(`${where}: ${e.message}`); }
  const { data, body } = parsed;
  for (const key of ["title", "description", "date"]) {
    if (!data[key] || typeof data[key] !== "string") throw new Error(`${where}: '${key}' ontbreekt`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(Date.parse(data.date))) throw new Error(`${where}: 'date' moet JJJJ-MM-DD zijn`);
  const category = data.category || "gids";
  if (!["gids", "nieuws"].includes(category)) throw new Error(`${where}: 'category' moet gids of nieuws zijn`);
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    lang,
    slug,
    url: postUrl(lang, slug),
    title: data.title,
    description: data.description,
    date: data.date,
    updated: data.updated || null,
    category,
    tags: typeof data.tags === "string" ? data.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    translation: typeof data.translation === "string" && data.translation ? data.translation : null,
    draft: data.draft === "true",
    sources: Array.isArray(data.sources) ? data.sources.map(parseSource) : [],
    readingMinutes: Math.max(1, Math.round(words / 220)),
    body
  };
}

function listFiles(lang) {
  const dir = path.join(CONTENT_DIR, lang);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
}

// Alle gepubliceerde artikelen in een taal, nieuwste eerst.
function getAllPosts(lang, { includeDrafts = false } = {}) {
  if (!LANGS.includes(lang)) return [];
  return listFiles(lang)
    .map((f) => readPost(lang, f))
    .filter((p) => includeDrafts || !p.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

function getPost(lang, slug) {
  if (!LANGS.includes(lang) || !SLUG_PATTERN.test(String(slug))) return null;
  if (!listFiles(lang).includes(`${slug}.md`)) return null;
  const post = readPost(lang, `${slug}.md`);
  return post.draft ? null : post;
}

// URL van de vertaling, alleen als die echt bestaat.
function translationUrl(post) {
  if (!post.translation) return null;
  const other = post.lang === "nl" ? "en" : "nl";
  return getPost(other, post.translation) ? postUrl(other, post.translation) : null;
}

// Externe links openen in een nieuw tabblad, zonder referrer-lek.
const renderer = new marked.Renderer();
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const external = /^https?:\/\//.test(href) && !href.startsWith(SITE_URL);
  const t = title ? ` title="${title}"` : "";
  return external ? `<a href="${href}"${t} target="_blank" rel="noopener noreferrer">${text}</a>` : `<a href="${href}"${t}>${text}</a>`;
};

function renderMarkdown(body) {
  return marked.parse(body, { renderer, gfm: true });
}

module.exports = { LANGS, SITE_URL, parseFrontmatter, getAllPosts, getPost, translationUrl, renderMarkdown, postUrl };
