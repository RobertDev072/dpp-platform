const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// Scanbeleid (docs/scans.md): wat telt als QR-scan, en dezelfde regels op de server en
// in de Cloudflare Worker.
const { isBot, isCountableBeacon, BOT_PATTERN } = require("../src/services/scanPolicy.service");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";

test("Browsers op een telefoon tellen; bots, linkpreviews en scripts niet", () => {
  for (const ua of [IPHONE, ANDROID]) assert.equal(isBot(ua), false, ua);
  for (const ua of [
    "",
    "Googlebot/2.1",
    "facebookexternalhit/1.1",
    "WhatsApp/2.24",
    "Slackbot-LinkExpanding 1.0",
    "TelegramBot (like TwitterBot)",
    "LinkedInBot/1.0",
    "Mozilla/5.0 HeadlessChrome/130.0",
    "curl/8.5.0",
    "python-requests/2.32",
    "node-fetch/3",
    "PostmanRuntime/7.39"
  ]) {
    assert.equal(isBot(ua), true, ua);
  }
});

test("Alleen een beacon van dezelfde site (Sec-Fetch-Site: same-origin) telt", () => {
  assert.equal(isCountableBeacon({ "user-agent": IPHONE, "sec-fetch-site": "same-origin" }), true);
  assert.equal(isCountableBeacon({ "user-agent": IPHONE }), false, "script zonder browserheader");
  assert.equal(isCountableBeacon({ "user-agent": IPHONE, "sec-fetch-site": "cross-site" }), false, "andere site");
  assert.equal(isCountableBeacon({ "user-agent": "curl/8", "sec-fetch-site": "same-origin" }), false);
});

test("Cloudflare Worker gebruikt exact hetzelfde botpatroon als de server", () => {
  const worker = fs.readFileSync(path.join(__dirname, "..", "edge", "cloudflare", "src", "index.js"), "utf8");
  assert.ok(worker.includes(BOT_PATTERN.toString()), "patroon in edge/cloudflare/src/index.js wijkt af");
  assert.match(worker, /sec-fetch-site"\) === "same-origin"/);
});

test("Paspoortpagina slaat niets op het apparaat op (geen cookie/localStorage voor scans)", () => {
  const beacon = fs.readFileSync(path.join(__dirname, "..", "components", "passport", "ScanBeacon.js"), "utf8");
  const code = beacon.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie|indexedDB/);
  assert.match(code, /reload|back_forward/, "verversen telt niet");
  assert.match(code, /src.*app/, "links vanuit de app tellen niet");
  assert.match(code, /navigator\.webdriver/);
});
