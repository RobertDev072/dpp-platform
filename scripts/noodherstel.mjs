#!/usr/bin/env node
// Noodherstel met één commando, vanaf je eigen pc (Windows, macOS of Linux met Node en ssh):
// maakt een nieuwe server bij Hetzner Cloud, zet VeriPasso daarop volledig terug vanuit de
// Hetzner Storage Box (deploy/recover.sh) en zet desgewenst de DNS om.
//
//   node scripts/noodherstel.mjs --test          hersteltest; server wordt daarna verwijderd
//   node scripts/noodherstel.mjs --live          echt herstel (server blijft draaien)
//   node scripts/noodherstel.mjs --live --switch-dns   + DNS van veripasso.com naar de nieuwe server
//
// Benodigde bestanden (uit het gegevensdocument; nooit in git):
//   --hetzner-token  pad  (standaard ~/hetzner-token.txt)          Hetzner Cloud API-token (Read & Write)
//   --storagebox-key pad  (standaard ~/veripasso-storagebox.key)    privé SSH-sleutel Storage Box (hoofdstuk 8b)
//   --passphrase     pad  (standaard ~/veripasso-backup-pass.txt)   back-up-wachtzin (hoofdstuk 4)
//   --cf-token       pad  (standaard ~/cloudflare-dns-token.txt)    alleen voor --switch-dns
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const home = os.homedir();
const MODE = flag("--live") ? "live" : "test";
const SWITCH_DNS = flag("--switch-dns");
const KEEP = flag("--keep");
const files = {
  token: opt("--hetzner-token", path.join(home, "hetzner-token.txt")),
  key: opt("--storagebox-key", path.join(home, "veripasso-storagebox.key")),
  pass: opt("--passphrase", path.join(home, "veripasso-backup-pass.txt")),
  cf: opt("--cf-token", path.join(home, "cloudflare-dns-token.txt"))
};
const here = path.dirname(fileURLToPath(import.meta.url));
const recoverScript = path.join(here, "..", "deploy", "recover.sh");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "noodherstel-"));
const started = Date.now();
const say = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

for (const [name, file] of Object.entries({ token: files.token, key: files.key, pass: files.pass })) {
  if (!fs.existsSync(file)) {
    console.error(`Bestand ontbreekt (${name}): ${file}. Zie het gegevensdocument.`);
    process.exit(1);
  }
}
const TOKEN = fs.readFileSync(files.token, "utf8").trim();

async function hcloud(method, url, body) {
  const res = await fetch(`https://api.hetzner.cloud/v1${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Hetzner ${method} ${url}: ${json.error?.message || res.status}`);
  return json;
}

function run(cmd, cmdArgs, { input, quiet = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { input, encoding: "utf8", stdio: quiet ? "pipe" : ["pipe", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} mislukte (${r.status}) ${quiet ? r.stderr : ""}`);
  return r.stdout;
}

async function main() {
  say(`Noodherstel VeriPasso, modus: ${MODE}${SWITCH_DNS ? " + DNS omzetten" : ""}`);
  // Tijdelijke SSH-sleutel om de nieuwe server te beheren (alleen voor deze sessie).
  const adminKey = path.join(work, "admin_ed25519");
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", adminKey], { quiet: true });
  const name = `veripasso-herstel-${Date.now().toString(36)}`;
  const { ssh_key: sshKey } = await hcloud("POST", "/ssh_keys", { name, public_key: fs.readFileSync(`${adminKey}.pub`, "utf8").trim() });
  let serverId = null;
  try {
    say("Server aanmaken bij Hetzner Cloud (Helsinki, 2 vCPU, 4 GB)");
    const created = await hcloud("POST", "/servers", {
      name,
      server_type: opt("--type", "cx23"),
      image: "ubuntu-24.04",
      location: opt("--location", "hel1"),
      ssh_keys: [sshKey.id],
      labels: { purpose: "veripasso-herstel", mode: MODE }
    });
    serverId = created.server.id;
    const ip = created.server.public_net.ipv4.ip;
    say(`Server ${name} → ${ip}; wachten tot hij opgestart is`);
    for (let i = 0; i < 60; i += 1) {
      const { server } = await hcloud("GET", `/servers/${serverId}`);
      if (server.status === "running") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const sshArgs = ["-i", adminKey, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10"];
    for (let i = 0; i < 36; i += 1) {
      const r = spawnSync("ssh", [...sshArgs, `root@${ip}`, "true"], { encoding: "utf8" });
      if (r.status === 0) break;
      await new Promise((r2) => setTimeout(r2, 5000));
    }
    say("Herstelscript en sleutels overzetten (alleen naar /root, rechten 600)");
    run("scp", [...sshArgs, recoverScript, `root@${ip}:/root/recover.sh`], { quiet: true });
    run("ssh", [...sshArgs, `root@${ip}`, "mkdir -p /root/.ssh && umask 077 && cat > /root/.ssh/veripasso_backup_ed25519"], { input: fs.readFileSync(files.key, "utf8").replace(/\r\n/g, "\n").trim() + "\n", quiet: true });
    run("ssh", [...sshArgs, `root@${ip}`, "umask 077 && cat > /root/.veripasso-backup-pass"], { input: fs.readFileSync(files.pass, "utf8").trim(), quiet: true });
    say("Herstel uitvoeren op de nieuwe server");
    run("ssh", [...sshArgs, `root@${ip}`, `bash /root/recover.sh ${MODE === "test" ? "--test" : ""}`]);
    const report = run("ssh", [...sshArgs, `root@${ip}`, "cat /root/herstel-verslag.txt"], { quiet: true });
    const reportFile = path.join(process.cwd(), `herstel-verslag-${new Date().toISOString().slice(0, 10)}.txt`);
    fs.writeFileSync(reportFile, `${report}\nServer: ${name} (${ip}), totale duur ${Math.round((Date.now() - started) / 60000)} min\n`);
    say(`Verslag opgeslagen: ${reportFile}`);

    if (SWITCH_DNS) {
      if (!fs.existsSync(files.cf)) throw new Error(`Cloudflare-token ontbreekt: ${files.cf}`);
      const cf = fs.readFileSync(files.cf, "utf8").trim();
      const cfApi = async (method, url, body) => {
        const res = await fetch(`https://api.cloudflare.com/client/v4${url}`, { method, headers: { Authorization: `Bearer ${cf}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const json = await res.json();
        if (!json.success) throw new Error(`Cloudflare ${url}: ${json.errors?.[0]?.message}`);
        return json.result;
      };
      const [zone] = await cfApi("GET", "/zones?name=veripasso.com");
      for (const host of ["veripasso.com", "www.veripasso.com", "app.veripasso.com", "qr.veripasso.com"]) {
        for (const rec of await cfApi("GET", `/zones/${zone.id}/dns_records?name=${host}`)) {
          if (rec.type === "A") await cfApi("PATCH", `/zones/${zone.id}/dns_records/${rec.id}`, { content: ip });
          if (rec.type === "AAAA") await cfApi("DELETE", `/zones/${zone.id}/dns_records/${rec.id}`);
        }
      }
      say(`DNS omgezet naar ${ip} (IPv6-records van de oude server verwijderd). Binnen enkele minuten actief.`);
    }
    if (MODE === "test" && !KEEP) {
      say("Testserver verwijderen (inclusief IP-adressen)");
      const ipIds = [created.server.public_net.ipv4?.id, created.server.public_net.ipv6?.id].filter(Boolean);
      await hcloud("DELETE", `/servers/${serverId}`);
      serverId = null;
      // IP-adressen komen kort na het verwijderen vrij; blijven ze staan, dan alsnog weg
      // (anders kosten ze een paar cent per dag).
      for (let i = 0; i < 12 && ipIds.length; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        for (const id of [...ipIds]) {
          const res = await fetch(`https://api.hetzner.cloud/v1/primary_ips/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
          if (res.status === 404) ipIds.splice(ipIds.indexOf(id), 1);
          else if ((await res.json()).primary_ip?.assignee_id == null) await hcloud("DELETE", `/primary_ips/${id}`).catch(() => {});
        }
      }
    } else {
      // Beheersleutel bewaren: zonder deze kun je niet inloggen op de nieuwe server.
      const keep = path.join(home, `${name}.key`);
      fs.copyFileSync(adminKey, keep);
      fs.chmodSync(keep, 0o600);
      say(`Server blijft draaien: ${ip}. Inloggen: ssh -i ${keep} root@${ip}  (bewaar deze sleutel bij het gegevensdocument)`);
    }
  } finally {
    if (serverId && MODE === "test" && !KEEP) await hcloud("DELETE", `/servers/${serverId}`).catch(() => {});
    await hcloud("DELETE", `/ssh_keys/${sshKey.id}`).catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
  say(`Klaar in ${Math.round((Date.now() - started) / 60000)} min.`);
}

main().catch((error) => {
  console.error(`MISLUKT: ${error.message}`);
  process.exit(1);
});
