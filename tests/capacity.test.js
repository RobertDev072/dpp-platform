const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Capaciteitsmonitoring (src/monitoring/capacity.js): schijf, geheugen, back-up,
// drempels en het openbare /api/health/capacity (alleen OK of namen van problemen).
const capacity = require("../src/monitoring/capacity");
const { sql } = require("../src/config/db");
const { startTestServer, stopTestServer, request } = require("./helpers/testServer");

function writeStatus(dir, status) {
  const file = path.join(dir, "last-backup.json");
  fs.writeFileSync(file, JSON.stringify(status));
  return file;
}

test("Drempels: hoger is slechter (schijf) en lager is slechter (certificaat-dagen)", () => {
  assert.equal(capacity.levelFor(50, { warn: 80, crit: 90 }), "ok");
  assert.equal(capacity.levelFor(85, { warn: 80, crit: 90 }), "warn");
  assert.equal(capacity.levelFor(95, { warn: 80, crit: 90 }), "crit");
  assert.equal(capacity.levelFor(60, { warn: 21, crit: 10 }, false), "ok");
  assert.equal(capacity.levelFor(15, { warn: 21, crit: 10 }, false), "warn");
  assert.equal(capacity.levelFor(5, { warn: 21, crit: 10 }, false), "crit");
  assert.equal(capacity.levelFor(null, { warn: 1, crit: 2 }), "unknown");
});

test("Schijf en geheugen: echte meting met percentage", () => {
  const disk = capacity.checkDisk(os.tmpdir());
  assert.ok(disk.totalBytes > 0 && disk.freeBytes >= 0);
  assert.ok(disk.usedPct >= 0 && disk.usedPct <= 100);
  const memory = capacity.checkMemory();
  assert.ok(memory.totalBytes > 0 && memory.usedPct >= 0 && memory.usedPct <= 100);
});

test("Back-up: leeftijd, ontbrekend bestand en alleen-lokaal geven de juiste status", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-backup-"));
  try {
    const recent = writeStatus(dir, { at: new Date(Date.now() - 2 * 3600000).toISOString(), bytes: 12000, offsite: true, offsiteTotalBytes: 50000 });
    const fresh = capacity.checkBackup(recent);
    assert.equal(fresh.level, "ok");
    assert.equal(fresh.offsite, true);
    assert.ok(fresh.ageHours >= 1.9 && fresh.ageHours <= 2.1);

    const localOnly = writeStatus(dir, { at: new Date().toISOString(), bytes: 1, offsite: false });
    assert.equal(capacity.checkBackup(localOnly).level, "warn", "alleen op de server = let op");

    const old = writeStatus(dir, { at: new Date(Date.now() - 3 * 86400000).toISOString(), bytes: 1, offsite: true });
    assert.equal(capacity.checkBackup(old).level, "crit", "back-up van 3 dagen oud = actie nodig");

    const missing = capacity.checkBackup(path.join(dir, "bestaat-niet.json"));
    assert.equal(missing.level, "crit");
    assert.match(missing.reason, /nog geen back-up/);

    assert.equal(capacity.checkBackup(undefined).level, "unknown", "niet ingesteld (lokaal) = onbekend");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("/api/health/capacity: OK zonder problemen, 503 met alleen de namen bij een probleem", async (t) => {
  const { server, baseUrl } = await startTestServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-backup-"));
  const saved = process.env.BACKUP_STATUS_FILE;
  t.after(async () => {
    if (saved === undefined) delete process.env.BACKUP_STATUS_FILE;
    else process.env.BACKUP_STATUS_FILE = saved;
    fs.rmSync(dir, { recursive: true, force: true });
    await stopTestServer(server);
    await sql.close();
  });

  process.env.BACKUP_STATUS_FILE = writeStatus(dir, { at: new Date().toISOString(), bytes: 12000, offsite: true });
  capacity.resetCacheForTests();
  const ok = await request(baseUrl, "GET", "/api/health/capacity");
  // Schijf of geheugen van de testmachine kan zelf vol zijn; dan staat dat in de melding.
  if (ok.status === 503) assert.match(ok.data, /^WAARSCHUWING: (schijf|geheugen)/);
  else assert.equal(ok.data, "OK");

  process.env.BACKUP_STATUS_FILE = writeStatus(dir, { at: new Date(Date.now() - 4 * 86400000).toISOString(), bytes: 1, offsite: true });
  capacity.resetCacheForTests();
  const stale = await request(baseUrl, "GET", "/api/health/capacity");
  assert.equal(stale.status, 503);
  assert.match(stale.data, /back-up/);
  assert.ok(!/\d{4}-\d{2}|bytes|\/status/.test(stale.data), "geen details of paden naar buiten");

  // Het uitgebreide overzicht is alleen voor de Platform Owner.
  assert.equal((await request(baseUrl, "GET", "/api/admin/system/capacity")).status, 401);
});
