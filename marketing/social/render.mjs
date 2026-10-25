// Maakt van posts.json de afbeeldingen (out/NN-datum.png, 1080×1350) en de kalender
// (kalender.md) met datum, tekst en hashtags om te kopiëren. Draait in Chrome, geen extra pakketten.
//   node render.mjs            alle posts
//   node render.mjs 0,5        alleen deze posts (index)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8766, DEBUG_PORT = 9334;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const posts = JSON.parse(fs.readFileSync(path.join(DIR, "posts.json"), "utf8"));
const only = process.argv[2] ? process.argv[2].split(",").map(Number) : posts.map((_, i) => i);
const fileName = (i) => `${String(i + 1).padStart(2, "0")}-${posts[i].date}.png`;

// Kalender
const days = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
let md = "# Contentkalender LinkedIn + Instagram\n\nElke dag: afbeelding uit `out/` + onderstaande tekst. Plaats de link op LinkedIn in de eerste reactie, op Instagram in je bio.\n";
posts.forEach((p, i) => {
  const d = new Date(`${p.date}T12:00:00Z`);
  md += `\n---\n\n## ${days[d.getUTCDay()]} ${p.date}: ${p.headline}\n\nAfbeelding: \`out/${fileName(i)}\`  \nLink: ${p.link}\n\n\`\`\`\n${p.caption}\n\n${p.hashtags}\n\`\`\`\n`;
});
fs.writeFileSync(path.join(DIR, "kalender.md"), md);

const server = http.createServer((req, res) => {
  const file = path.join(DIR, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(DIR) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "text/html; charset=utf-8");
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${path.join(DIR, "chrome-render")}`, "about:blank"], { stdio: "ignore" });
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const waiting = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1350, deviceScaleFactor: 1, mobile: false });
  fs.mkdirSync(path.join(DIR, "out"), { recursive: true });
  for (const i of only) {
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/card.html?i=${i}` });
    for (let k = 0; k < 80; k++) {
      const r = await send("Runtime.evaluate", { expression: "window.cardReady === true", returnByValue: true });
      if (r?.result?.value) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(DIR, "out", fileName(i)), Buffer.from(data, "base64"));
  }
  console.log("afbeeldingen:", only.length, "· kalender.md bijgewerkt");
  ws.close();
} finally {
  chrome.kill(); server.close();
}
