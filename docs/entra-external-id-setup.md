# Microsoft Entra External ID — handmatige Azure-configuratie

Deze stappen kan alleen jij uitvoeren (Azure/Entra-portaltoegang). De code in deze repo
is al voorbereid: zolang de onderstaande environment variables niet allemaal gezet zijn,
blijft de bestaande bcrypt/sessie-login gewoon werken. De app schakelt automatisch over
zodra alles is ingevuld: `isEntraLoginConfigured()` voor inloggen, `isEntraConfigured()`
(login + Graph) voor het aanmaken van accounts — zie `src/config/entra.js`.

## 1. Externe tenant aanmaken

Entra ID → Overview → **Manage tenants** → **Create** → **External** (niet "Workforce").
Kies een Azure-abonnement + resource group (of gebruik eerst de 30-dagen gratis trial).
Duurt tot ~30 minuten. Geen kosten voor het aanmaken zelf — billing is Monthly Active
Users (MAU)-based, eerste 50.000 MAU/maand gratis, daarna ± $0,03/MAU (live prijs
checken op de Azure-pricingpagina).

## 2. Twee app-registraties (bewust gescheiden, least privilege)

**a) `dpp-platform-web`** — voor de inlog-flow (delegated, gebruiker aanwezig)
- Platform: **Web**
- Redirect URI's: `https://<jouw-app-service>.azurewebsites.net/auth/redirect`
  en, voor lokaal ontwikkelen, `http://localhost:3000/auth/redirect`
  (het pad moet exact `/auth/redirect` zijn: Entra post de authorization code daarheen
  met `response_mode=form_post`, zie `docs/architecture-roles.md` §8 — een ander pad
  eindigt bij elke login in een 404)
- Voeg ook de `ENTRA_POST_LOGOUT_REDIRECT_URI` (`https://<jouw-app-service>.azurewebsites.net/login.html`,
  lokaal `http://localhost:3000/login.html`) toe als redirect URI: Entra stuurt na
  "Uitloggen" (`GET /auth/logout` → end-session endpoint) alleen terug naar een
  geregistreerde URI
  (`localhost` mag http zijn — de poort wordt genegeerd bij matching, maar Microsoft
  raadt aan dev/prod liever in aparte registraties te houden; voor MVP is één
  registratie met beide URI's acceptabel)
- Genereer een **client secret** (Certificates & secrets)
- **Token configuration**: controleer dat het ID-token een `email`-claim bevat (de app vraagt
  de scopes `openid profile email`); voeg anders de optionele claim `email` (token type ID)
  toe. DPP gebruikt die claim alleen voor de eenmalige koppeling op e-mailadres (§9); daarna
  herkent DPP de gebruiker aan de `sub`-claim
- Noteer: Application (client) ID, Directory (tenant) ID, het secret

**b) `dpp-platform-graph-service`** — voor de backend/daemon (app-only, geen gebruiker)
- **Geen** redirect URI nodig
- Genereer een **client secret**
- Onder **API permissions** → Microsoft Graph → **Application permissions**, voeg toe
  (zie tabel hieronder) en klik daarna **Grant admin consent**

## 3. Microsoft Graph application permissions

| Permissie | Waarvoor | Vertrouwen |
|---|---|---|
| `User.Create` | Nieuwe medewerker-accounts aanmaken | Bevestigd via officiële Graph API-referentie |
| `User.Read.All` | Users opzoeken/lijsten | Bevestigd |
| `User.ReadUpdate.All` | Algemene velden bijwerken | Bevestigd |
| `User.EnableDisableAccount.All` | Account blokkeren bij deactiveren in DPP | Bevestigd |
| `User-PasswordProfile.ReadWrite.All` | Tijdelijk wachtwoord zetten bij aanmaak + admin-reset-fallback | Bevestigd — let op: dit is de **enige** manier om `passwordProfile` te zetten, `User.ReadWrite.All` dekt dit expliciet NIET |

**Bewust vermeden:** `User.ReadWrite.All` / `Directory.ReadWrite.All` (te breed — voegt
niets toe bovenop de rijtjes hierboven, behalve onnodig bereik).

**Belangrijke beperking om te weten:** deze permissies zijn **altijd tenant-breed** —
Microsoft Graph heeft geen manier om een app-only permissie te beperken tot "alleen
company A" (Administrative Units werken hier niet voor, en zijn sowieso niet
bruikbaar/gelicenseerd in External-tenants). De isolatie tussen bedrijven wordt dus
**volledig** afgedwongen door DPP's eigen backend-code (company_id-check vóór elke
Graph-call), niet door Entra/Graph zelf. Dat is precies zoals gevraagd (Company Admin
krijgt nooit directe Graph-toegang), maar betekent ook: het `dpp-platform-graph-service`
app-secret is zelf een high-value asset — behandel het net zo gevoelig als een
database-wachtwoord.

**Nog te verifiëren, niet aangenomen:** het (optioneel) uitschakelen van publieke
zelfregistratie op de user flow (stap 5) gebruikt een **beta** Graph-endpoint waarvan ik
de exacte vereiste permissie niet met zekerheid kon bevestigen uit de officiële
referentie (vermoedelijk iets als `Policy.ReadWrite.AuthenticationFlows` of
`EventListener.ReadWrite.All` — controleer dit in de Graph API-referentie of Graph
Explorer voordat je admin consent geeft voor iets extra's).

## 4. User flow

Entra ID → **External Identities** → **User flows** → **New user flow** →
sign-up-and-sign-in, methode **Email met wachtwoord**. Koppel de `dpp-platform-web`
app-registratie aan deze user flow.

## 5. (Optioneel maar aanbevolen) Zelfregistratie uitschakelen

Er is geen publieke self-signup gewenst (Company Admin maakt alle accounts aan). Dit is
in de portal-UI geen aparte optie — het moet via een Graph `beta`-call:

```
PATCH https://graph.microsoft.com/beta/identity/authenticationEventsFlows/{user-flow-id}
{
  "@odata.type": "#microsoft.graph.externalUsersSelfServiceSignUpEventsFlow",
  "onInteractiveAuthFlowStart": {
    "@odata.type": "#microsoft.graph.onInteractiveAuthFlowStartExternalUsersSelfServiceSignUp",
    "isSignUpAllowed": false
  }
}
```

Doe dit pas nadat je de juiste permissie hierboven hebt bevestigd en toegekend. Zonder
deze stap werkt de app functioneel ook prima (er is toch geen publieke sign-up-link
zichtbaar), maar dit sluit het "sign up"-pad hard af als extra zekerheid.

## 6. MFA via Conditional Access — geen P1/P2-licentie nodig

In tegenstelling tot workforce-tenants vereist Conditional Access in een External-tenant
**geen** Entra ID P1/P2 — alleen de rol **Security Administrator** om het in te stellen.

1. **MFA-methode**: zet onder Authentication methods **Email one-time passcode** aan (gratis;
   dezelfde methode als voor SSPR in §7). Zet **geen** SMS aan: SMS-verificatie is in
   External ID een betaalde add-on.
2. Maak één security group aan (Entra ID → Groups), bijv. `DPP-Standard-Users`.
3. Conditional Access → New policy:
   - **Include**: All users (dit is momenteel de enige optie in External-tenants)
   - **Exclude**: de groep `DPP-Standard-Users`
   - **Grant**: Require multifactor authentication
4. **Wie hoort in `DPP-Standard-Users`?** Alleen medewerkers zonder beheerrechten, voor wie
   je bewust geen verplichte MFA wilt: `product_manager`, `compliance_manager`, `company_user`
   en `viewer`. **Nooit** `system_owner` of `company_admin`: die vallen daardoor automatisch
   onder de policy (Include all, geen uitzondering) en krijgen verplichte MFA.

De groep is een **uitzonderingsgroep**, en de DPP-backend voegt niemand automatisch toe. Dat
betekent:

- Een nieuwe **Company Admin** (Entra-account aangemaakt bij het activeren van de uitnodiging,
  `docs/architecture-roles.md` §5) zit nooit in de groep en heeft dus vanaf de eerste login
  verplichte MFA. Er is geen risicovenster.
- Een nieuwe **medewerker** heeft ook verplichte MFA totdat jij hem aan `DPP-Standard-Users`
  toevoegt. Dat is de veilige kant: zonder handmatige actie is er MFA, niet minder.
- **Rolwijziging naar `company_admin`** (alleen de System Owner kan dat, via
  Gebruikers → Naam en rol wijzigen): haal het account **direct** uit `DPP-Standard-Users`,
  anders houdt deze beheerder geen verplichte MFA. De SO-UI toont deze waarschuwing ook.

Dit is bewust **niet** geautomatiseerd vanuit de DPP-backend: dat zou een extra
Graph-permissie (`GroupMember.ReadWrite.All`, tenant-breed) vereisen voor een kleine,
laagfrequente actie. Controleer de groep af en toe (Entra → Groups → Members) tegen de
Company Admins in DPP (Platformbeheer → Company Admins).

## 7. Wachtwoord vergeten: Self-Service Password Reset (SSPR)

SSPR is de standaardweg voor "Wachtwoord vergeten?" en kost niets extra. Gebruikers krijgen
een verificatiecode per e-mail en kiezen zelf een nieuw wachtwoord; niemand bij DPP ziet dat
wachtwoord.

1. Zet **Email one-time passcode** aan als authenticatiemethode (Entra admin center →
   Authentication methods → Policies → Email OTP → Enable, doelgroep All users). Dit is
   dezelfde methode als voor MFA (§6).
2. Toon de link **"Wachtwoord vergeten?"** op de Entra-inlogpagina: Company branding →
   Default sign-in → Edit → tab *Sign-in form* → **Show self-service password reset** aanvinken
   (zie ook §8).
3. Test het met een testaccount: DPP-loginpagina → e-mailadres → Doorgaan → op de Entra-pagina
   "Wachtwoord vergeten?" → code uit de mail → nieuw wachtwoord.

De DPP-loginpagina (`/login.html`) legt dit in Entra-modus uit onder "Wachtwoord vergeten?" en
heeft een knop die direct naar de Entra-pagina gaat, ook zonder ingevuld e-mailadres. De
precieze menunamen in de portal kunnen wijzigen; zoek zo nodig op "self-service password
reset" in de documentatie van Microsoft Entra External ID.

**Fallback in DPP** (`POST /api/users/:id/reset-password`): de Company Admin (of de System
Owner) zet via Graph een tijdelijk wachtwoord (`User-PasswordProfile.ReadWrite.All`, beperkt
door DPP's eigen company_id-check). Dat is bedoeld voor een medewerker die geen toegang meer
heeft tot zijn mailbox, niet als standaardweg.

## 8. Company branding: de DPP-huisstijl op de wachtwoordpagina

Na stap 1 op `/login.html` (e-mailadres) toont Entra de wachtwoordstap op
`<tenant>.ciamlogin.com`. Via **Company branding** (gratis, onderdeel van elke External-tenant)
lijkt die pagina op de DPP-loginpagina, zodat gebruikers niet schrikken van een andere
omgeving:

Entra admin center → **Company branding** → **Default sign-in** → **Edit**:

- *Basics*: favicon (DPP-logo), paginakleur `#0f172a` (de donkere DPP-kleur uit
  `public/css/styles.css`, `--sidebar-bg`) of een achtergrondafbeelding.
- *Layout*: een template met het formulier in het midden, zoals `/login.html`.
- *Sign-in form*: banner logo (het DPP-logo, liggend formaat), "Show self-service password
  reset" aan (§7) en eventueel een korte tekst, bijv. "Log in met je DPP-account".
- *Footer*: links naar privacyverklaring en voorwaarden, als je die hebt.

De indeling van de tabbladen kan per portalversie iets verschillen; de instellingen zelf
(logo, kleuren, SSPR-link) zijn in elke External-tenant gratis.

Zet onder **User flows** → je flow → **Languages** Nederlands aan, zodat de Entra-pagina's
dezelfde taal hebben als DPP. Een volledig eigen wachtwoordformulier binnen DPP kan later via
Entra's *native authentication* API; dat is een aparte stap en niet nodig voor MVP.

## 9. System Owner en bestaande accounts koppelen (just-in-time op e-mailadres)

Zodra de login-variabelen uit §10 gezet zijn, is Entra de enige manier om in te loggen:
`POST /api/auth/login` (lokaal wachtwoord) gaat dicht (`404 LOCAL_LOGIN_DISABLED`), ook voor de
System Owner. Een lokaal wachtwoord zou anders Entra en de MFA-policy omzeilen. Accounts
die al in DPP bestonden (de System Owner uit `npm run seed:owner`, medewerkers die in lokale
modus zijn aangemaakt) worden daarom bij hun eerste Entra-login eenmalig gekoppeld:

1. Maak **vóór** het omzetten in de External-tenant een gebruiker aan met **exact hetzelfde
   e-mailadres** als in DPP (Entra admin center → Users → New user, aanmelden met e-mailadres
   en wachtwoord). Zet dit account **niet** in `DPP-Standard-Users`:
   de System Owner krijgt verplichte MFA.
2. Zet de Entra-variabelen (§10) en herstart de app.
3. Log in via `/login.html`. DPP zoekt eerst op de Entra `sub`-claim; is die nog onbekend, dan
   koppelt DPP de identiteit eenmalig aan het **actieve**, nog niet gekoppelde DPP-account met
   hetzelfde e-mailadres (hoofdletterongevoelig; zie `src/services/entraLogin.service.js`).
   Daarbij wordt het lokale wachtwoord (`password_hash`) gewist: vanaf dan kan dit account
   alleen nog via Entra inloggen.
4. Geen actief DPP-account met dat e-mailadres? Dan geen koppeling en meldt de loginpagina
   `no_account`. Is het account al gekoppeld maar niet (meer) actief, of is het bedrijf niet
   actief, dan `inactive`. Een al gekoppeld account (`entra_subject_id` gezet) wordt nooit
   opnieuw aan een andere Entra-identiteit gehangen.

Zorg dat alleen jij (en eventuele mede-beheerders) gebruikers in de External-tenant kunnen
aanmaken, en laat zelfregistratie uit (§5): wie een Entra-account met het e-mailadres van
een ongekoppeld DPP-account kan aanmaken, wordt bij de eerste login aan dat account gekoppeld.
Nieuwe accounts na het omzetten maakt DPP zelf aan via Graph (Company Admins bij activatie,
medewerkers via "Medewerker toevoegen"). Die hebben nooit een lokaal wachtwoord en krijgen hun
`sub`-koppeling op dezelfde manier bij de eerste login.

## 10. Environment variables (App Service Application Settings + lokale `.env`)

```
ENTRA_TENANT_NAME=jouw-tenant-naam        (het stuk vóór .onmicrosoft.com / .ciamlogin.com)
ENTRA_TENANT_ID=...                        (Directory/tenant ID, beide app-registraties delen dezelfde tenant)
ENTRA_WEB_CLIENT_ID=...                    (van dpp-platform-web)
ENTRA_WEB_CLIENT_SECRET=...
ENTRA_GRAPH_CLIENT_ID=...                  (van dpp-platform-graph-service)
ENTRA_GRAPH_CLIENT_SECRET=...
ENTRA_REDIRECT_URI=https://.../auth/redirect           (exact dit pad, gelijk aan de redirect URI in de app-registratie)
ENTRA_POST_LOGOUT_REDIRECT_URI=https://.../login.html
COOKIE_SECRET=...                          (willekeurige lange string, voor het signeren van de korte OIDC-state-cookie — GEEN Entra-secret, zelf te genereren, bv. met `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
```

Nooit in `.env` committen (staat al in `.gitignore`); op Azure als Application Settings.

## 11. Wat blijft ongewijzigd werken

Zolang de login-variabelen (`ENTRA_TENANT_NAME`, `ENTRA_TENANT_ID`, `ENTRA_WEB_CLIENT_ID`,
`ENTRA_WEB_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`, `ENTRA_POST_LOGOUT_REDIRECT_URI`,
`COOKIE_SECRET`) niet allemaal gezet zijn: `POST /api/auth/login` (bcrypt) blijft
100% functioneel voor bestaande accounts (zoals de gezaaide System Owner). Zodra ze wel
allemaal gezet zijn, gaat de lokale login dicht; koppel de System Owner daarom eerst (§9). Nieuwe
gebruikers aanmaken via `POST /api/users` valt in die situatie terug op het oude
wachtwoord-invoerveld. Zodra alle env vars gezet zijn, schakelt user-creation
automatisch over naar Entra-provisioning — er hoeft geen code aangepast te worden.
