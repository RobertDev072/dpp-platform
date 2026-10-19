#!/usr/bin/env node
// Bouwt het VeriPasso-noodpakket: een map (en ZIP) die je op elke Windows-pc uitpakt op C:\ en
// waarin je alleen nog dubbelklikt. Bevat Node.js (portable), de herstelscripts en .bat-bestanden.
//
//   node scripts/maak-noodpakket.mjs --node <pad naar node.exe> --out <map>
//   node scripts/maak-noodpakket.mjs ... --met-sleutels    kopieert ook de sleutelbestanden uit je
//                                                           gebruikersmap (draai dit ZELF; het resultaat
//                                                           is zo geheim als het gegevensdocument)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, f) => (args.includes(n) ? args[args.indexOf(n) + 1] : f);
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = opt("--out", path.join(os.homedir(), "Documents", "VeriPasso-Noodpakket"));
const nodeExe = opt("--node", process.execPath);
const KEY_FILES = [
  ["strato_ed25519", ".ssh/id_ed25519", "SSH-sleutel van de STRATO-server (gegevensdocument hoofdstuk 3)"],
  ["hetzner-token.txt", "hetzner-token.txt", "Hetzner Cloud API-token, project veripasso-herstel"],
  ["veripasso-storagebox.key", "veripasso-storagebox.key", "SSH-sleutel van de Hetzner Storage Box (hoofdstuk 8b)"],
  ["veripasso-backup-pass.txt", "veripasso-backup-pass.txt", "back-up-wachtzin (hoofdstuk 4)"],
  ["cloudflare-dns-token.txt", "cloudflare-dns-token.txt", "Cloudflare DNS-token"],
  ["ntfy-token.txt", "ntfy-token.txt", "ntfy-token (meldingen)"],
  ["ntfy-topic.txt", "ntfy-topic.txt", "ntfy-kanaal (meldingen)"]
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "programma"), { recursive: true });
fs.mkdirSync(path.join(out, "sleutels"), { recursive: true });
fs.copyFileSync(nodeExe, path.join(out, "programma", "node.exe"));
fs.copyFileSync(path.join(repo, "scripts", "noodherstel.mjs"), path.join(out, "programma", "noodherstel.mjs"));
fs.copyFileSync(path.join(repo, "deploy", "recover.sh"), path.join(out, "programma", "recover.sh"));

const bat = (title, nodeArgs, intro) => `@echo off
chcp 65001 >nul
title VeriPasso - ${title}
cd /d "%~dp0"
set "VERIPASSO_KEYS=%~dp0sleutels"
set "VERIPASSO_STATE=%~dp0"
rem Sleutels alleen leesbaar voor jou (anders weigert Windows-ssh ze).
for %%f in ("%~dp0sleutels\\*") do icacls "%%f" /inheritance:r /grant:r "%USERNAME%:F" >nul 2>&1
echo.
echo ==== VeriPasso: ${title} ====
echo ${intro}
echo.
"%~dp0programma\\node.exe" "%~dp0programma\\noodherstel.mjs" ${nodeArgs}
echo.
pause
`;
const files = {
  "1-STATUS-BEKIJKEN.bat": bat("status bekijken", "", "Kijkt wat er plat ligt. Maakt niets aan en wijzigt niets."),
  "2-STRATO-HERSTARTEN.bat": bat("STRATO herstarten", "--repair", "Start de app opnieuw op de STRATO-server (alleen als die bereikbaar is)."),
  "3-NIEUWE-SERVER-MAKEN.bat": bat("nieuwe server maken", "--new-server", "Maakt een nieuwe server bij Hetzner en zet alles terug uit de back-up. Vraagt eerst om JA. DNS blijft nog op STRATO."),
  "4-DNS-OMZETTEN.bat": bat("DNS omzetten", "--switch-dns", "Zet veripasso.com om naar de nieuwe server uit stap 3. Vraagt eerst om JA."),
  "0-PROEF-HERSTEL.bat": bat("proef herstel", "--test", "Proef: herstel op een tijdelijke server, die daarna weer verwijderd wordt (ca. 4 min, minder dan 2 cent).")
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(out, name), content.replace(/\n/g, "\r\n"));

const readme = `VERIPASSO NOODPAKKET
====================

GEHEIM: deze map bevat (met sleutels) toegang tot alle servers en back-ups. Bewaar hem
alleen op een versleutelde USB-stick of in je wachtwoordkluis. Na gebruik op een vreemde pc:
de map weer verwijderen.

GEBRUIK (Windows 10/11, niets installeren)
1. Pak de ZIP uit op C:\\  -> je krijgt C:\\VeriPasso-Noodpakket
2. Dubbelklik in die map, in deze volgorde:

   1-STATUS-BEKIJKEN.bat     Wat ligt er plat? Altijd eerst. Maakt niets aan.
                             Volg het ADVIES onderaan.
   2-STRATO-HERSTARTEN.bat   Als STRATO bereikbaar is maar de app niet werkt.
   (STRATO-klantpaneel)      Server onbereikbaar: kijk op strato-status.de, herstart via
                             het STRATO-paneel of de VNC-console, 30-60 min afwachten.
                             QR-codes van klanten werken intussen gewoon (noodkopie).
   3-NIEUWE-SERVER-MAKEN.bat Alleen als STRATO echt plat blijft. Typ JA.
                             Na 5-10 min draait VeriPasso op een nieuwe server.
                             Lees het verslag: alle tellingen moeten kloppen.
   4-DNS-OMZETTEN.bat        Daarna: typ JA. Binnen enkele minuten is VeriPasso weer live.

   0-PROEF-HERSTEL.bat       Oefenen zonder gevolgen (elk kwartaal doen).

Liever PowerShell? Open PowerShell in deze map en typ bijv.:  .\\1-STATUS-BEKIJKEN.bat

SLEUTELS (map "sleutels")
${KEY_FILES.map(([n, , d]) => `  ${n.padEnd(27)} ${d}`).join("\r\n")}

Meer uitleg: docs/noodplan.md in de VeriPasso-repository.
`;
fs.writeFileSync(path.join(out, "LEES-MIJ.txt"), readme.replace(/\r?\n/g, "\r\n"));

let copied = 0;
if (args.includes("--met-sleutels")) {
  for (const [name, source] of KEY_FILES) {
    const src = path.join(os.homedir(), source);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(out, "sleutels", name));
      copied += 1;
    } else console.log(`Let op: niet gevonden, zelf toevoegen: ${src} -> sleutels\\${name}`);
  }
} else {
  fs.writeFileSync(path.join(out, "sleutels", "ZET-HIER-DE-SLEUTELS.txt"), `Zet hier de sleutelbestanden (zie LEES-MIJ.txt):\r\n${KEY_FILES.map(([n]) => `  ${n}`).join("\r\n")}\r\n`);
}

const zip = `${out}.zip`;
fs.rmSync(zip, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -CompressionLevel Optimal`]);
console.log(`Noodpakket: ${out}\nZIP:        ${zip} (${Math.round(fs.statSync(zip).size / 1048576)} MB)\nSleutels:   ${args.includes("--met-sleutels") ? `${copied} van ${KEY_FILES.length} gekopieerd` : "niet meegenomen"}`);
