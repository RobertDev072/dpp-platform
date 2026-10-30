# Hosting op Oracle Cloud (sinds 2026-10-30)

STRATO en de Hetzner Storage Box zijn uitgezet. VeriPasso draait nu op een gratis
Oracle Cloud-server (Always Free), met dezelfde opzet als op STRATO (`deploy/compose.yaml`:
app + PostgreSQL 17 + Caddy).

| Wat | Waarde |
|---|---|
| Server | Oracle Cloud, VM.Standard.A1.Flex (ARM, 1 OCPU, 6 GB), Ubuntu 24.04, 45 GB |
| IPv4 | 158.180.35.95 (geen IPv6) |
| Inloggen | `ssh root@158.180.35.95` of `ssh ubuntu@158.180.35.95` (alleen SSH-sleutel) |
| Firewall | Oracle Security List: 22, 80, 443; op de server iptables (Oracle-image) met 80/443 open |
| Code / configuratie | `/opt/veripasso`, `/opt/veripasso/deploy/.env` |
| Back-up | cron 03:15 UTC → lokaal + Cloudflare R2 `veripasso-backups/db` |
| DNS | Cloudflare: `@`, `www`, `app`, `qr` → A 158.180.35.95, proxied |

Teruggezet uit de R2-back-up van 2026-10-27 03:15 UTC (3 bedrijven, 6 gebruikers,
12 producten). Gegevens ingevoerd tussen 27 en 30 oktober zaten niet in die back-up.

Open punten:
- Derde back-upkopie (Hetzner Storage Box) staat uit: de systeemstatus waarschuwt daarom
  "back-up". Nieuwe externe kopie kiezen of de waarschuwing aanpassen.
- `EDGE_SYNC_TOKEN` ontbreekt in de `.env` (stond niet in het gegevensdocument): de
  noodkopieën in Cloudflare worden niet bijgewerkt tot die waarde terug is.
- Oracle kan stilstaande gratis servers terugnemen: account omzetten naar Pay As You Go
  (blijft gratis binnen de limieten).
