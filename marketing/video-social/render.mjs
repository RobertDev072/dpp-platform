// Opname en codering van de productvideo met Chrome (geen ffmpeg nodig).
//   node render.mjs preview 2,10,15.5,…   losse controlebeelden (preview/NN.png)
//   node render.mjs frames                 alle beelden (frames/00000.jpg, 30 per seconde)
//   node render.mjs encode                 beelden + voice-over + muziek → VeriPasso-video.mp4
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const PORT = 8765;
const DEBUG_PORT = 9333;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [mode = "preview", arg = ""] = process.argv.slice(2);
const timing = JSON.parse(fs.readFileSync(path.join(DIR, "timing.json"), "utf8"));
const VW = timing.width || 1920, VH = timing.height || 1080;
// SCALE=2 rendert scherp op dubbele resolutie (1080×1350 → 2160×2700, "4K").
const SCALE = Number(process.env.SCALE || 1);
const TOTAL = Math.round(timing.END * FPS);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav", ".json": "application/json", ".md": "text/plain; charset=utf-8", ".mp4": "video/mp4" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "POST" && url.pathname === "/save") {
    const name = path.basename(url.searchParams.get("name") || "out.bin");
    const out = fs.createWriteStream(path.join(DIR, name));
    req.pipe(out);
    out.on("finish", () => { res.end("ok"); console.log("opgeslagen:", name); });
    return;
  }
  if (req.method === "POST" && url.pathname === "/log") {
    let body = "";
    req.on("data", (c) => (body += c)).on("end", () => { console.log("[pagina]", body); res.end("ok"); });
    return;
  }
  const file = path.join(DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

async function cdp() {
  const profile = path.join(DIR, "chrome-render");
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `--window-size=${VW},${VH}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  if (!target) throw new Error("Chrome start niet");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const close = () => { try { ws.close(); } catch {} chrome.kill(); };
  await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: SCALE, mobile: false });
  return { send, evaluate, close };
}

async function open(page, url, flag) {
  await page.send("Page.navigate", { url });
  for (let i = 0; i < 240; i++) {
    if (await page.evaluate(`window.${flag} === true`).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} niet klaar`);
}

async function shot(page, t, file, format = "jpeg") {
  await page.evaluate(`window.seek(${t})`);
  const { data } = await page.send("Page.captureScreenshot", format === "png" ? { format: "png" } : { format: "jpeg", quality: SCALE > 1 ? 96 : 92, optimizeForSpeed: SCALE === 1 });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const page = await cdp();
try {
  if (mode === "preview") {
    fs.mkdirSync(path.join(DIR, "preview"), { recursive: true });
    await open(page, `http://127.0.0.1:${PORT}/composition.final.html`, "videoReady");
    const times = arg.split(",").map(Number).filter((n) => !Number.isNaN(n));
    for (const [i, t] of times.entries()) await shot(page, t, path.join(DIR, "preview", `${String(i).padStart(2, "0")}-${t}s.png`), "png");
    console.log("voorbeelden:", times.length);
  } else if (mode === "frames") {
    const dir = path.join(DIR, "frames");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await open(page, `http://127.0.0.1:${PORT}/composition.final.html`, "videoReady");
    const started = Date.now();
    for (let f = 0; f < TOTAL; f++) {
      await shot(page, f / FPS, path.join(dir, `${String(f).padStart(5, "0")}.jpg`));
      if (f % 300 === 0) console.log(`beeld ${f}/${TOTAL} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
    console.log("alle beelden:", TOTAL);
  } else if (mode === "verify") {
    await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/README.md` });
    await new Promise((r) => setTimeout(r, 800));
    const info = await page.evaluate(`new Promise((ok) => { const v = document.createElement("video"); v.src = "/${arg}"; v.muted = false; v.onloadedmetadata = async () => { v.currentTime = 20; v.play().catch(() => {}); await new Promise((r) => setTimeout(r, 1500)); ok({ duur: v.duration, b: v.videoWidth, h: v.videoHeight, audioBytes: v.webkitAudioDecodedByteCount }); }; v.onerror = () => ok({ fout: v.error && v.error.code }); document.body.appendChild(v); })`);
    console.log("controle:", info);
  } else if (mode === "probe") {
    await open(page, `http://127.0.0.1:${PORT}/encode.html?frames=1&fps=${FPS}&w=${VW * SCALE}&h=${VH * SCALE}`, "encodeReady");
    console.log("ondersteund:", await page.evaluate("window.probe()"));
  } else if (mode === "encode") {
    await open(page, `http://127.0.0.1:${PORT}/encode.html?frames=${TOTAL}&fps=${FPS}&w=${VW * SCALE}&h=${VH * SCALE}`, "encodeReady");
    const result = await page.evaluate("window.runEncode()");
    console.log("codering:", result);
  }
} finally {
  page.close();
  server.close();
}
