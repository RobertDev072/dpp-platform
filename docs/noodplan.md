# Noodplan VeriPasso

Wat te doen als iets misgaat. Server en beheer: [hosting-strato.md](hosting-strato.md).
Wachtwoorden en sleutels staan **niet** hier, maar in het beveiligde gegevensdocument
(buiten deze repository).

## Snel: wat ligt eruit en wat doe ik?

Je krijgt een pushmelding (ntfy-app, kanaal uit het gegevensdocument) met de naam van wat
eruit ligt. Daarnaast: <https://www.cloudflarestatus.com> en <https://www.strato-status.de>.

| Melding / symptoom | Wat ligt eruit | QR-codes? | Wat doe je |
|---|---|---|---|
| "STORING: App" + "Website" | STRATO-server of de app | **werken** (noodkopie) | 15–30 min afwachten (vaak herstart of onderhoud). Inloggen kan? → scenario 1. Server/console onbereikbaar en STRATO-status meldt een storing, of na 1 uur nog plat → **stap 1–4 hieronder** |
| "STORING: Database" (app wel) | database | werken (noodkopie) | scenario 4 |
| "Capaciteit en back-ups" | schijf vol, back-up mislukt, certificaat | werken | Systeemstatus in de app; scenario 2 of back-uplog |
| "BACK-UP MISLUKT" / "Derde back-up MISLUKT" | back-up (rest werkt) | werken | `/var/log/veripasso-backup.log`; morgen opnieuw controleren |
| QR toont "tijdelijk niet beschikbaar" | server én Cloudflare R2 | **werken niet** | Cloudflare-status; bij langdurige R2-storing scenario 6 |
| Hele domein onbereikbaar, geen meldingen | Cloudflare (DNS) | werken niet | <https://www.cloudflarestatus.com>; afwachten (zeldzaam, meestal kort) |
| Data blijkt beschadigd of gewist | database | werken (oude versie) | scenario 4 (terugzetten van vóór het probleem) |

### Stap voor stap bij een storing (niets gebeurt vanzelf)

Op je eigen pc, in **PowerShell**, in de map `C:Usersdailydpp-platform`. Bestanden uit het
gegevensdocument in je gebruikersmap: `hetzner-token.txt`, `veripasso-storagebox.key`,
`veripasso-backup-pass.txt`, `cloudflare-dns-token.txt` (en `ntfy-token.txt`, `ntfy-topic.txt`).

| Stap | Commando | Wat gebeurt er |
|---|---|---|
| 1. Diagnose | `node scripts/noodherstel.mjs` | Laat zien wat er plat ligt (app, database, QR, STRATO bereikbaar via SSH/HTTPS, schijf, geheugen, logfouten) en geeft advies. **Maakt niets aan.** |
| 2. STRATO repareren | `node scripts/noodherstel.mjs --repair` | Alleen als STRATO bereikbaar is: containers opnieuw starten en controleren. |
| — | STRATO-account | Server onbereikbaar: kijk op strato-status.de; herstart via het STRATO-klantpaneel of VNC-console; 30–60 min afwachten. QR-codes werken intussen via de noodkopie. |
| 3. Nieuwe server | `node scripts/noodherstel.mjs --new-server` | **Alleen als STRATO echt plat blijft.** Vraagt om "JA". Nieuwe server bij Hetzner Cloud (ca. € 7/mnd), alles terug uit de back-up, beveiliging en back-ups ingericht; wordt de actieve back-upserver. **DNS blijft nog op STRATO.** Verslag met tellingen en controles. |
| 4. DNS omzetten | `node scripts/noodherstel.mjs --switch-dns <IP>` | Pas als het verslag van stap 3 klopt. Vraagt om "JA". Oude DNS-records worden in een bestand bewaard. |
| Proef | `node scripts/noodherstel.mjs --test` | Herstel op een tijdelijke server, daarna verwijderd (ca. 4 min, < € 0,02). |

Bescherming tegen verkeerde back-ups: na stap 3 is de nieuwe server de "actieve" server
(`veripasso/ACTIVE_SERVER` op de Storage Box). Duikt STRATO later weer op, dan uploadt STRATO
**geen** back-ups meer (je krijgt een melding), zodat de nieuwste gegevens niet overschreven worden.

**Terug naar STRATO** (als die weer werkt en je wilt terug): op de nieuwe server een back-up maken
(`/opt/veripasso/deploy/backup.sh`), die op STRATO terugzetten (scenario 4), op STRATO
`cat /etc/machine-id | rclone rcat hetzner:veripasso/ACTIVE_SERVER`, DNS terugzetten met de waarden uit
het bewaarde bestand, nieuwe server verwijderen.

Getest: [verification/hersteltest-2026-10-19.md](verification/hersteltest-2026-10-19.md).

## Waar staat wat

| Wat | Waar | Bewaard |
|---|---|---|
| Database-back-ups | server: `/var/backups/veripasso/*.dump.gpg` | 7 dagen |
| Database-back-ups (kopie) | Cloudflare R2: bucket `veripasso-backups`, map `db/` | onbeperkt (handmatig opruimen) |
| **Derde kopie (alles)** | Hetzner Storage Box `u694623.your-storagebox.de` (Helsinki, SFTP poort 23), map `veripasso/`: `db/` (dumps), `config/` (versleutelde .env), `files/veripasso-images`, `files/veripasso-documents` | dumps en config 30 dagen; bestanden onbeperkt; plus 10 dagelijkse Hetzner-snapshots (niet te wissen vanaf de server) |
| Status laatste back-up | server: `/var/lib/veripasso-status/last-backup.json` | — |
| Back-uplog | server: `/var/log/veripasso-backup.log` | — |
| Foto's en documenten | Cloudflare R2: `veripasso-images`, `veripasso-documents` | onbeperkt; staan niet op de server |
| App-logs | `docker compose logs app` (in `/opt/veripasso/deploy`) | tot de container opnieuw wordt gemaakt |
| HTTPS-logs | `docker compose logs caddy` | idem |
| Systeemlogs, inlogpogingen | `journalctl`, `/var/log/auth.log`, `fail2ban-client status sshd` | volgens Ubuntu |
| Code | GitHub `RobertDev072/dpp-platform`; server `/opt/veripasso` | — |
| Configuratie + geheimen | server `/opt/veripasso/deploy/.env` + gegevensdocument | — |

Back-ups zijn versleuteld. **Zonder de back-up-wachtzin zijn ze waardeloos**: die staat op
de server (`/root/.veripasso-backup-pass`) en in het gegevensdocument.

## Waarschuwingen

- **Systeemstatus** in de app (Platform Owner), sectie "Capaciteit en back-ups".
- **Extern:** monitor (bijv. UptimeRobot, gratis) op
  - `https://app.veripasso.com/api/health` → site plat;
  - `https://app.veripasso.com/api/health/capacity` → `503` = schijf, geheugen, back-up,
    certificaat of opslag vraagt aandacht (de tekst noemt welke).

## Gedrukte QR-codes blijven altijd werken

- Elke QR-code bevat alleen `https://qr.veripasso.com/p/<ID>`. Het ID is een willekeurige
  UUID die bij het aanmaken wordt toegekend, uniek is in de database (unieke index) en
  **nooit** verandert of opnieuw wordt uitgegeven. Ook een gearchiveerd product blijft
  bereikbaar (met de melding dat het niet meer actief wordt aangeboden).
- Bij een storing van de server toont Cloudflare de **noodkopie** van het paspoort (alle
  productgegevens, foto en logo; documenten zijn dan pas weer te openen als de server
  terug is). Zie [cloudflare.md](cloudflare.md).
- Nooit wijzigen: het DNS-record `qr`, `QR_BASE_URL` en de public_id's in de database.

## Scenario's

Inloggen op de server: `ssh root@87.106.4.92`. Werkt SSH niet: VNC-console in het
STRATO-klantenpaneel (root-wachtwoord).

### 1. Site is niet bereikbaar
1. Controleer `https://app.veripasso.com/api/health`. Werkt de server zelf nog? `ssh root@87.106.4.92`.
2. Geen SSH: STRATO-klantenpaneel → server status; eventueel **herstarten**. Staat de
   STRATO-firewall per ongeluk aan zonder regels, dan blokkeert die alles (uitzetten of 22/80/443 openzetten).
3. Wel SSH: `cd /opt/veripasso/deploy && docker compose ps`. Niet alles "Up"/"healthy":
   `docker compose up -d`, dan `docker compose logs --tail=100 app`.
4. DNS controleren (Cloudflare): A/AAAA van `@`, `www`, `app`, `qr` naar de server.

### 2. Schijf vol
`df -h`. Opruimen: `docker system prune -f` (oude images), `journalctl --vacuum-size=200M`,
oude back-ups in `/var/backups/veripasso`. Structureel: groter STRATO-pakket.

### 3. Fout na een nieuwe versie
Terug naar de vorige versie:
```bash
cd /opt/veripasso && git log --oneline -5      # vorige commit opzoeken
git reset --hard <vorige-commit> && cd deploy
GIT_SHA=$(git rev-parse HEAD) docker compose up -d --build
```
Migraties zijn altijd additief, dus de oude versie werkt op het nieuwe schema. Daarna de
fout in de code herstellen en opnieuw uitrollen (`update.sh` zet de server weer op `main`).

### 4. Data kwijt of beschadigd (database)
1. Kies de back-up van vóór het probleem: `ls -lt /var/backups/veripasso` (of uit R2:
   `rclone ls r2:veripasso-backups/db` en `rclone copy r2:veripasso-backups/db/<bestand> /var/backups/veripasso/`).
2. Eerst een back-up van de huidige (kapotte) stand: `/opt/veripasso/deploy/backup.sh`.
3. Terugzetten:
   ```bash
   cd /opt/veripasso/deploy
   gpg --batch --passphrase-file /root/.veripasso-backup-pass -d /var/backups/veripasso/<bestand>.dump.gpg > /tmp/restore.dump
   docker compose stop app
   docker compose exec -T db pg_restore -U veripasso -d veripasso --clean --if-exists < /tmp/restore.dump
   docker compose start app && rm /tmp/restore.dump
   ```
4. Alles wat na die back-up is ingevoerd, is weg: nagaan via de auditlog en gebruikers informeren.

Foto's en documenten staan in R2 en worden nooit overschreven; die hoeven niet terug.

### 5. Server helemaal kwijt (defect, gehackt, opgezegd)
Doel: binnen enkele uren weer online op een nieuwe server.
1. Nieuwe VPS (STRATO of elders), Ubuntu 24.04, met de SSH-sleutel uit het gegevensdocument.
2. Inrichten volgens [hosting-strato.md](hosting-strato.md) → "Opnieuw opbouwen". Gebruik voor
   `deploy/.env` de **oude waarden** uit het gegevensdocument (vooral `MFA_ENCRYPTION_KEY`
   en `COOKIE_SECRET`), en zet de back-up-wachtzin terug in `/root/.veripasso-backup-pass`.
3. rclone-remote `r2` met de R2-sleutel uit het gegevensdocument; laatste back-up ophalen
   uit `r2:veripasso-backups/db` en terugzetten (scenario 4, stap 3).
4. Cloudflare DNS: A/AAAA-records naar het nieuwe IP-adres.
5. Controleren: inloggen, een paspoort openen (`qr.veripasso.com/p/…`), foto zichtbaar,
   systeemstatus groen. Cron voor de back-up niet vergeten.

Bij een **hack**: daarnaast alle geheimen vervangen (databasewachtwoord, `COOKIE_SECRET`
— iedereen moet opnieuw inloggen —, R2-sleutels, Cloudflare-tokens, SSH-sleutel). Let op:
`MFA_ENCRYPTION_KEY` vervangen betekent dat iedereen MFA opnieuw moet instellen.

### 5b. STRATO én Cloudflare kwijt (of het Cloudflare-account gekaapt)
Alles staat ook op de Hetzner Storage Box. Herstel op een nieuwe server:
1. Nieuwe VPS zoals in scenario 5, stap 1–2.
2. SSH-sleutel voor de Storage Box: de oude staat op de oude server; maak anders een nieuwe
   (`ssh-keygen -t ed25519 -f /root/.ssh/veripasso_backup_ed25519`) en voeg de publieke sleutel
   toe in de Hetzner-console (Storage Box → SSH keys). Daarna:
   `rclone config create hetzner sftp host=u694623.your-storagebox.de port=23 user=u694623 key_file=/root/.ssh/veripasso_backup_ed25519`
3. Configuratie: `rclone copy hetzner:veripasso/config /tmp/cfg`, ontsleutelen met de wachtzin
   (`gpg -d …`) naar `deploy/.env`.
4. Database: laatste dump uit `hetzner:veripasso/db` en terugzetten (scenario 4, stap 3).
5. Bestanden: nieuwe objectopslag (nieuw Cloudflare-account of andere S3-aanbieder),
   `rclone copy hetzner:veripasso/files/veripasso-images <nieuw>:veripasso-images` (idem documenten),
   en `S3_*` in `deploy/.env` aanpassen.
6. DNS bij de nieuwe DNS-aanbieder naar het nieuwe IP; QR-domein `qr.veripasso.com` moet blijven
   bestaan (gedrukte codes).
Is de Storage Box zelf geleegd (hack): Hetzner-console → Snapshots → laatste goede snapshot
terugzetten.

Hersteltest vanaf Hetzner uitgevoerd op 2026-10-18: dump teruggezet in een tijdelijke database,
alle tellingen gelijk aan live; configuratie identiek; bestanden gelijk aan R2.

### 6. Cloudflare R2 onbereikbaar
De site werkt verder; alleen uploads, downloads en de back-upkopie falen tijdelijk.
Back-ups blijven lokaal 7 dagen bewaard en op de Hetzner Storage Box. Status: <https://www.cloudflarestatus.com>.

### 7. Certificaat verloopt of HTTPS-fout
Caddy verlengt automatisch (poort 80 en 443 moeten open staan, DNS moet kloppen).
`docker compose logs caddy | grep -i error`, daarna `docker compose restart caddy`.

### 8. Inloggen lukt niet meer (Platform Owner)
- **Wachtwoord vergeten:** nieuw wachtwoord zetten met `scripts/seed-system-owner.js`
  (zie hosting-strato.md → Beheer).
- **MFA-apparaat kwijt:** eerst een van de herstelcodes gebruiken (bewaard bij het instellen
  van MFA). Geen herstelcodes meer: MFA op de server uitzetten en daarna opnieuw instellen:
  ```bash
  cd /opt/veripasso/deploy
  docker compose exec -T db psql -U veripasso -d veripasso -c "UPDATE dbo.users SET mfa_secret_enc=NULL, mfa_pending_secret_enc=NULL, mfa_enabled_at=NULL, mfa_recovery_hashes=NULL, mfa_last_step=NULL WHERE lower(email)=lower('<e-mailadres>')"
  ```

## Datalek (persoonsgegevens mogelijk ingezien, gewijzigd of verloren)

Voorbeelden: iemand kwam binnen op de server, een gegevensdocument of sleutel is gelekt,
een gebruiker zag gegevens van een ander bedrijf, een back-up of R2-sleutel is uitgelekt.

1. **Indammen (direct):** toegang afsluiten (betreffende sleutels/tokens intrekken, wachtwoorden
   resetten, sessies beëindigen; bij een hack de server offline halen, zie scenario 5).
2. **Vastleggen:** tijdstip van ontdekken, wat er gebeurd is, welke gegevens en van wie, hoeveel
   personen, genomen maatregelen. Elk datalek komt in het datalekregister, ook als het niet
   gemeld hoeft te worden (art. 33 lid 5 AVG). Bronnen: auditlog, `docs/noodplan.md`-logs.
3. **Beoordelen en melden** (art. 33/34 AVG):
   - Is VeriPasso **verwerker** voor deze gegevens (gegevens van een klant)? Dan de klant
     (verwerkingsverantwoordelijke) **onverwijld** informeren; die beslist over melden.
   - Is VeriPasso **verwerkingsverantwoordelijke**? Melden bij de Autoriteit
     Persoonsgegevens **binnen 72 uur** na ontdekking, tenzij het lek waarschijnlijk geen
     risico oplevert. Bij een hoog risico ook de betrokkenen informeren.
   - Welke rol VeriPasso per verwerking heeft: nog vast te stellen (`docs/compliance/wettelijke-matrix.md`).
4. **Herstellen en evalueren:** oorzaak oplossen, controleren, dit noodplan bijwerken.

Contactpersoon datalekken: [nog in te vullen].

## Regelmatig testen

- Elk kwartaal: een back-up terugzetten in een testdatabase (`createdb restore_test` →
  `pg_restore` → controleren → `dropdb`).
- Het gegevensdocument actueel houden na elke wijziging van een wachtwoord of sleutel.
