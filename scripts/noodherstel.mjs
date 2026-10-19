#!/usr/bin/env node
// Noodherstel VeriPasso, vanaf je eigen pc (PowerShell, macOS of Linux; Node en ssh nodig).
// Werkt in stappen; niets gebeurt zonder dat jij het kiest:
//
//   node scripts/noodherstel.mjs                  1. DIAGNOSE (standaard): wat ligt eruit? Maakt niets aan.
//   node scripts/noodherstel.mjs --repair         2. STRATO repareren: app opnieuw starten (server moet bereikbaar zijn)
//   node scripts/noodherstel.mjs --new-server     3. nieuwe server bij Hetzner Cloud + alles terug uit de back-up
//                                                    (vraagt eerst om "JA"; DNS blijft nog naar STRATO wijzen)
//   node scripts/noodherstel.mjs --switch-dns IP  4. DNS van veripasso.com omzetten naar IP (vraagt om "JA")
//   node scripts/noodherstel.mjs --test           proef: herstel op een tijdelijke server, daarna verwijderd
//
// Bestanden in je gebruikersmap (uit het gegevensdocument; nooit in git):
//   hetzner-token.txt, veripasso-storagebox.key, veripasso-backup-pass.txt, cloudflare-dns-token.txt,
//   optioneel ntfy-token.txt en ntfy-topic.txt (meldingen op de nieuwe server).
import { spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const home = os.homedir();
// Sleutelmap: VERIPASSO_KEYS (noodpakket: de map "sleutels" naast de .bat-bestanden), anders je gebruikersmap.
const KEYS = process.env.VERIPASSO_KEYS || home;
const file = (name) => path.join(KEYS, name);
// Laatst gemaakte noodserver (voor --switch-dns zonder IP).
const LAST_SERVER = path.join(process.env.VERIPASSO_STATE || process.cwd(), "laatste-nieuwe-server.txt");
const here = path.dirname(fileURLToPath(import.meta.url));
const recoverScript = [path.join(here, "..", "deploy", "recover.sh"), path.join(here, "recover.sh")].find((f) => fs.existsSync(f));
const STRATO_IP = opt("--strato-ip", "87.106.4.92");
const started = Date.now();
const say = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const NUL = process.platform === "win32" ? "NUL" : "/dev/null";

function need(name) {
  if (!fs.existsSync(file(name))) {
    console.error(`Bestand ontbreekt: ${file(name)} (zie het gegevensdocument).`);
    process.exit(1);
  }
  return fs.readFileSync(file(name), "utf8").trim();
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question}\nTyp JA om door te gaan: `)).trim();
  rl.close();
  if (answer !== "JA") {
    console.log("Afgebroken; er is niets gewijzigd.");
    process.exit(0);
  }
}

function run(cmd, cmdArgs, { input, quiet = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { input, encoding: "utf8", stdio: quiet ? "pipe" : ["pipe", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} mislukte (${r.status}) ${quiet ? r.stderr : ""}`);
  return r.stdout;
}

async function httpStatus(url) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    return res.status;
  } catch {
    return 0;
  }
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 5000 }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// STRATO-sleutel: "strato_ed25519" in de sleutelmap (noodpakket), anders de standaardsleutel van deze pc.
const stratoSsh = (command) => {
  const key = file("strato_ed25519");
  const keyArgs = fs.existsSync(key) ? ["-i", key, "-o", "IdentitiesOnly=yes"] : [];
  return spawnSync("ssh", [...keyArgs, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", `root@${STRATO_IP}`, command], { encoding: "utf8" });
};

// --- 1. diagnose ---------------------------------------------------------------------------
async function diagnose() {
  say("DIAGNOSE (maakt niets aan, wijzigt niets)");
  const appIp = await dns.resolve4("app.veripasso.com").catch(() => []);
  const checks = {
    app: await httpStatus("https://app.veripasso.com/api/health"),
    database: await httpStatus("https://app.veripasso.com/api/health/ready"),
    qr: await httpStatus("https://qr.veripasso.com/p/00000000-0000-4000-8000-000000000000"),
    ssh: await portOpen(STRATO_IP, 22),
    https: await portOpen(STRATO_IP, 443)
  };
  console.log(`
  DNS app.veripasso.com     → ${appIp.join(", ") || "NIET OP TE ZOEKEN"} ${appIp.includes(STRATO_IP) ? "(STRATO)" : "(niet STRATO)"}
  App                       → ${checks.app === 200 ? "OK" : `PLAT (${checks.app || "geen antwoord"})`}
  Database                  → ${checks.database === 200 ? "OK" : `PLAT (${checks.database || "geen antwoord"})`}
  QR-domein (via Cloudflare)→ ${checks.qr && checks.qr < 500 ? "OK (bereikbaar)" : checks.qr ? `storing (${checks.qr}); QR-codes tonen de noodkopie` : "geen antwoord"}
  STRATO poort 22 (SSH)     → ${checks.ssh ? "open" : "DICHT / onbereikbaar"}
  STRATO poort 443 (HTTPS)  → ${checks.https ? "open" : "DICHT / onbereikbaar"}`);

  if (checks.ssh) {
    const r = stratoSsh(
      "cd /opt/veripasso/deploy && docker compose ps --format '{{.Name}}: {{.Status}}'; df -h / | tail -1 | awk '{print \"schijf: \"$5\" vol\"}'; free -m | awk 'NR==2{print \"geheugen vrij: \"$7\" MB\"}'; uptime -p; docker compose logs --since 30m app 2>&1 | grep -ciE 'error' | xargs echo 'fouten in app-log (30 min):'"
    );
    console.log(`\n  STRATO-server (via SSH):\n${(r.stdout || r.stderr || "").replace(/^/gm, "    ")}`);
  }

  console.log("\n  ADVIES:");
  if (checks.app === 200 && checks.database === 200) {
    console.log("  Alles werkt. Niets te doen.");
  } else if (checks.ssh) {
    console.log("  De STRATO-server is bereikbaar; de app of database werkt niet.");
    console.log("  → Probeer eerst:  node scripts/noodherstel.mjs --repair");
  } else {
    console.log("  De STRATO-server is onbereikbaar.");
    console.log("  1. Kijk op https://www.strato-status.de en in je STRATO-account (server-login of VNC-console).");
    console.log("     Is het onderhoud of een storing: 30–60 minuten afwachten. QR-codes werken intussen via de noodkopie.");
    console.log("  2. Lukt herstarten via STRATO niet en blijft het plat (of meldt STRATO een langdurig probleem):");
    console.log("     node scripts/noodherstel.mjs --new-server      (nieuwe server; DNS nog niet om)");
    console.log("     node scripts/noodherstel.mjs --switch-dns IP   (pas daarna, als de nieuwe server goed is)");
  }
}

// --- 2. STRATO repareren ----------------------------------------------------------------------
async function repair() {
  say("STRATO repareren: containers opnieuw starten");
  const r = stratoSsh("cd /opt/veripasso/deploy && docker compose up -d 2>&1 | tail -3; sleep 25; docker compose ps --format '{{.Name}}: {{.Status}}'");
  if (r.status !== 0 && !r.stdout) {
    console.log("Kan niet inloggen op STRATO. Gebruik de STRATO-console (herstart/VNC) of ga naar --new-server.");
    process.exit(1);
  }
  console.log(r.stdout);
  const ok = (await httpStatus("https://app.veripasso.com/api/health/ready")) === 200;
  say(ok ? "Hersteld: de app werkt weer." : "Nog niet hersteld. Bekijk de logs (docker compose logs app) of ga naar --new-server.");
}

// --- 3. nieuwe server ---------------------------------------------------------------------------
async function newServer({ test }) {
  const TOKEN = need("hetzner-token.txt");
  const storageKey = need("veripasso-storagebox.key");
  const passphrase = need("veripasso-backup-pass.txt");
  const hcloud = async (method, url, body) => {
    const res = await fetch(`https://api.hetzner.cloud/v1${url}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`Hetzner ${method} ${url}: ${json.error?.message || res.status}`);
    return json;
  };
  if (!test) {
    await confirm(
      "Er wordt een NIEUWE server aangemaakt bij Hetzner Cloud (ca. € 7 per maand zolang hij draait) en VeriPasso\n" +
        "wordt daarop teruggezet uit de laatste back-up. De DNS blijft voorlopig naar STRATO wijzen."
    );
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "noodherstel-"));
  const adminKey = path.join(work, "admin_ed25519");
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", adminKey], { quiet: true });
  const name = `veripasso-herstel-${Date.now().toString(36)}`;
  const { ssh_key: sshKey } = await hcloud("POST", "/ssh_keys", { name, public_key: fs.readFileSync(`${adminKey}.pub`, "utf8").trim() });
  let serverId = null;
  let created = null;
  try {
    say("Server aanmaken bij Hetzner Cloud (Helsinki, 2 vCPU, 4 GB)");
    created = await hcloud("POST", "/servers", {
      name,
      server_type: opt("--type", "cx23"),
      image: "ubuntu-24.04",
      location: opt("--location", "hel1"),
      ssh_keys: [sshKey.id],
      labels: { purpose: "veripasso-herstel", mode: test ? "test" : "live" }
    });
    serverId = created.server.id;
    const ip = created.server.public_net.ipv4.ip;
    say(`Server ${name} → ${ip}; wachten tot hij opgestart is`);
    for (let i = 0; i < 60; i += 1) {
      if ((await hcloud("GET", `/servers/${serverId}`)).server.status === "running") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const sshArgs = ["-i", adminKey, "-o", "StrictHostKeyChecking=no", "-o", `UserKnownHostsFile=${NUL}`, "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10"];
    for (let i = 0; i < 36; i += 1) {
      if (spawnSync("ssh", [...sshArgs, `root@${ip}`, "true"]).status === 0) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    say("Herstelscript en sleutels overzetten (alleen naar /root, rechten 600)");
    run("scp", [...sshArgs, recoverScript, `root@${ip}:/root/recover.sh`], { quiet: true });
    const put = (target, content) => run("ssh", [...sshArgs, `root@${ip}`, `mkdir -p /root/.ssh && umask 077 && cat > ${target}`], { input: content, quiet: true });
    put("/root/.ssh/veripasso_backup_ed25519", storageKey.replace(/\r\n/g, "\n") + "\n");
    put("/root/.veripasso-backup-pass", passphrase);
    if (fs.existsSync(file("ntfy-topic.txt"))) put("/root/.veripasso-ntfy", need("ntfy-topic.txt"));
    if (fs.existsSync(file("ntfy-token.txt"))) put("/root/.veripasso-ntfy-token", need("ntfy-token.txt"));
    say("Herstel uitvoeren op de nieuwe server");
    run("ssh", [...sshArgs, `root@${ip}`, `bash /root/recover.sh ${test ? "--test" : ""}`]);
    const report = run("ssh", [...sshArgs, `root@${ip}`, "cat /root/herstel-verslag.txt"], { quiet: true });
    const reportFile = path.join(process.cwd(), `herstel-verslag-${new Date().toISOString().slice(0, 10)}.txt`);
    fs.writeFileSync(reportFile, `${report}\nServer: ${name} (${ip}), totale duur ${Math.round((Date.now() - started) / 60000)} min\n`);
    say(`Verslag opgeslagen: ${reportFile}`);

    if (test && !flag("--keep")) {
      say("Testserver verwijderen (inclusief IP-adressen)");
      const ipIds = [created.server.public_net.ipv4?.id, created.server.public_net.ipv6?.id].filter(Boolean);
      await hcloud("DELETE", `/servers/${serverId}`);
      serverId = null;
      for (let i = 0; i < 12 && ipIds.length; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        for (const id of [...ipIds]) {
          const res = await fetch(`https://api.hetzner.cloud/v1/primary_ips/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
          if (res.status === 404) ipIds.splice(ipIds.indexOf(id), 1);
          else if ((await res.json()).primary_ip?.assignee_id == null) await hcloud("DELETE", `/primary_ips/${id}`).catch(() => {});
        }
      }
    } else {
      const keep = file(`${name}.key`);
      fs.writeFileSync(LAST_SERVER, `${ip}
`);
      fs.copyFileSync(adminKey, keep);
      fs.chmodSync(keep, 0o600);
      console.log(`
  De nieuwe server draait: ${ip}
  Inloggen:            ssh -i ${keep} root@${ip}   (bewaar deze sleutel bij het gegevensdocument)
  Controleren:         het verslag hierboven (tellingen, hashketen, bestanden, paspoort).
  Pas als alles klopt: node scripts/noodherstel.mjs --switch-dns ${ip}
  Bedacht? Verwijder de server in de Hetzner-console (project veripasso-herstel).`);
    }
  } finally {
    if (serverId && test && !flag("--keep")) await hcloud("DELETE", `/servers/${serverId}`).catch(() => {});
    await hcloud("DELETE", `/ssh_keys/${sshKey.id}`).catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- 4. DNS omzetten -----------------------------------------------------------------------------
async function switchDns(ip) {
  if (!net.isIPv4(ip || "")) {
    console.error("Gebruik: node scripts/noodherstel.mjs --switch-dns <IPv4-adres van de nieuwe server>");
    process.exit(1);
  }
  const cf = need("cloudflare-dns-token.txt");
  const cfApi = async (method, url, body) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${url}`, { method, headers: { Authorization: `Bearer ${cf}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!json.success) throw new Error(`Cloudflare ${url}: ${json.errors?.[0]?.message}`);
    return json.result;
  };
  const health = await httpStatus(`http://${ip}/api/health`);
  await confirm(
    `De DNS van veripasso.com, www, app en qr wordt omgezet naar ${ip}.\n` +
      `Bezoekers en QR-scans gaan daarna naar de nieuwe server (de nieuwe server antwoordt nu: ${health || "geen antwoord"}).\n` +
      "STRATO krijgt geen verkeer meer; zet STRATO later pas terug na het overzetten van de nieuwste gegevens (noodplan)."
  );
  const [zone] = await cfApi("GET", "/zones?name=veripasso.com");
  const old = [];
  for (const host of ["veripasso.com", "www.veripasso.com", "app.veripasso.com", "qr.veripasso.com"]) {
    for (const rec of await cfApi("GET", `/zones/${zone.id}/dns_records?name=${host}`)) {
      if (rec.type === "A") {
        old.push(`${host} A ${rec.content}`);
        await cfApi("PATCH", `/zones/${zone.id}/dns_records/${rec.id}`, { content: ip });
      }
      if (rec.type === "AAAA") {
        old.push(`${host} AAAA ${rec.content}`);
        await cfApi("DELETE", `/zones/${zone.id}/dns_records/${rec.id}`);
      }
    }
  }
  const backup = path.join(process.cwd(), `dns-voor-omschakeling-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`);
  fs.writeFileSync(backup, `${old.join("\n")}\n`);
  say(`DNS omgezet naar ${ip}. Oude records bewaard in ${backup}. Binnen enkele minuten actief; HTTPS-certificaten volgen automatisch.`);
}

const main = async () => {
  if (flag("--test")) return newServer({ test: true });
  if (flag("--new-server") || flag("--live")) return newServer({ test: false });
  if (flag("--switch-dns")) {
    const ip = opt("--switch-dns") || (fs.existsSync(LAST_SERVER) ? fs.readFileSync(LAST_SERVER, "utf8").trim() : "");
    return switchDns(ip);
  }
  if (flag("--repair")) return repair();
  return diagnose();
};

main()
  .then(() => say(`Klaar (${Math.round((Date.now() - started) / 1000)} s).`))
  .catch((error) => {
    console.error(`MISLUKT: ${error.message}`);
    process.exit(1);
  });
