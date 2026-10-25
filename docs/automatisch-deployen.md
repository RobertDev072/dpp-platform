# Automatisch uitrollen na goedkeuring

Na een merge naar `main` (bijvoorbeeld een goedgekeurd blogartikel) draait de CI. Zijn de
tests, de build en de servertest groen, dan start de job `deploy` op de live server
`/opt/veripasso/deploy/update.sh` (maakt eerst een back-up, bouwt, herstart, controleert
de gezondheid) en controleert daarna www, /blog, /dpp-check en de app.

Zonder de twee GitHub-geheimen hieronder slaat de job zichzelf over; dan rol je zoals
voorheen met de hand uit.

## Eenmalig instellen (± 5 minuten)

De sleutel mag op de server **alleen** `update.sh` starten: geen shell, geen
port-forwarding. Lekt hij ooit uit, dan kan iemand hooguit de nieuwste versie van `main`
opnieuw uitrollen.

**1. Op de server** (`ssh root@87.106.4.92`):

```sh
ssh-keygen -t ed25519 -N "" -C github-deploy -f /root/github-deploy
echo "command=\"/opt/veripasso/deploy/update.sh\",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding $(cat /root/github-deploy.pub)" >> /root/.ssh/authorized_keys
cat /root/github-deploy        # privésleutel: kopiëren voor stap 2
```

**2. In GitHub**: repository → *Settings* → *Secrets and variables* → *Actions* →
*New repository secret*:

| Naam | Waarde |
|---|---|
| `DEPLOY_SSH_KEY` | de volledige inhoud van `/root/github-deploy` (inclusief de BEGIN/END-regels) |
| `DEPLOY_KNOWN_HOSTS` | uitvoer van `ssh-keygen -F 87.106.4.92` op je eigen pc (de regel zonder `#`) |

**3. Op de server**: de privésleutel weer weghalen.

```sh
rm /root/github-deploy /root/github-deploy.pub
```

## Intrekken

Verwijder de regel met `github-deploy` uit `/root/.ssh/authorized_keys` en verwijder de
twee geheimen in GitHub.
