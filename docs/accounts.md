# Accounts: aanmaken, activeren, wachtwoorden

Stand: 2026-10-14. VeriPasso verstuurt **geen e-mail** (besluit 2026-10-14). Links en
tijdelijke wachtwoorden worden op het scherm getoond aan degene die het account aanmaakt,
die ze zelf veilig doorgeeft.

## Rollen

| Rol | Maakt aan | Mag niet |
|---|---|---|
| **Platform Owner** (1 account) | partners + eerste Partner Admin; plannen; alle bedrijven | — |
| **Partner Admin** | eigen klantbedrijven + eerste Company Admin (één formulier) | andere partners, platforminstellingen, producten van klanten |
| **Company Admin** | medewerkers van het eigen bedrijf; producten, documenten, QR | andere bedrijven, partners, abonnement wijzigen |
| **Company Employee** (`company_user`) | producten, documenten, QR binnen het eigen bedrijf | gebruikers, abonnementsgegevens, bedrijfsinstellingen |

Alles wordt op de server afgedwongen (rol + bedrijf uit de sessie, nooit uit het verzoek);
het menu verbergt alleen. Bewijs: `tests/roles-accounts-scans.test.js` (A-O),
`tests/partner-layer.test.js`, `tests/license-tenant-isolation.test.js`.

**Open beslissing:** fijnmazige rechten per medewerker (bijv. "alleen bekijken") bestaan
niet; een medewerker mag producten aanmaken en wijzigen. Gewenst? Dan is dat een nieuwe
functie.

## Flows

```
Platform Owner ──"Nieuwe partner"──> partner + activatielink voor de Partner Admin
Partner Admin  ──"Nieuw klantbedrijf"──> klantbedrijf + activatielink voor de Company Admin
Company Admin  ──"Medewerkers"──> medewerker + tijdelijk wachtwoord
```
Bedrijf en eerste beheerder ontstaan in **één databasetransactie** (alles of niets;
`src/services/onboarding.service.js`). Opnieuw indienen geeft 409 (unieke slug); een
e-mailadres met een bestaand account wordt geweigerd.

## Activatielink

| Eis | Uitvoering |
|---|---|
| 48 uur geldig | `expires_at = uitgifte + 48 uur`, server-side gecontroleerd (`invites.repository.js`) |
| onvoorspelbaar | 256 bit (`crypto.randomBytes(32)`) |
| alleen hash in de database | SHA-256 in `companyadmininvites.token_hash` |
| eenmalig | atomair claimen (`status pending → accepted`); twee gelijktijdige activaties: één slaagt |
| nieuwe link → oude ongeldig | eerdere openstaande link voor hetzelfde bedrijf + e-mail wordt ingetrokken; unieke index op openstaande links |
| verlopen | 410 met uitleg ("48 uur geldig, vraag een nieuwe link") |
| geen half account | eerst claimen, dan account; mislukt het account, dan wordt de link weer vrijgegeven |
| niet in logs | routes worden genormaliseerd gelogd; het token staat alleen in het antwoord aan de uitgever |

De gebruiker kiest bij activatie zelf een wachtwoord (min. 12 tekens); er bestaat voor
dit account nooit een tijdelijk wachtwoord.

## Tijdelijk wachtwoord (medewerkers, en herstel)

| Eis | Uitvoering |
|---|---|
| max. 24 uur geldig | `users.temp_password_expires_at`; login en wachtwoordwijziging weigeren daarna (`TEMP_PASSWORD_EXPIRED`) |
| cryptografisch willekeurig | `src/utils/tempPassword.js` (16 tekens) |
| nooit platte tekst | alleen bcrypt-hash |
| eerste login: eigen wachtwoord verplicht | `must_change_password` → `/api/auth/change-password` |
| daarna direct ongeldig | eigen wachtwoord vervangt de hash; vervaltijd gewist; oude sessies ingetrokken |
| nieuw eigen wachtwoord ≠ tijdelijk | gecontroleerd |

## Wachtwoord vergeten

Zonder e-mail is er geen zelfservice-herstel. "Wachtwoord vergeten" verwijst naar de
beheerder; die geeft een nieuw tijdelijk wachtwoord (24 uur). Een Company Admin vraagt
het aan de partner of VeriPasso. Bij een reset worden alle lopende sessies ingetrokken.
Een partner kan alleen beheerders van de eigen klanten resetten; een Company Admin alleen
gebruikers van het eigen bedrijf. De loginpagina zegt nooit of een account bestaat
(zelfde melding en minimale duur bij een fout); inloggen heeft een rate limit per IP en
per e-mailadres.

Wordt later e-mail toegevoegd, dan horen resetlinks een **eigen** token te krijgen (niet
het activatietoken), met korte geldigheid (bijv. 1 uur) en dezelfde eenmalige claim.
