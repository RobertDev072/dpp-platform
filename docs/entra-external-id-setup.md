# Microsoft Entra External ID — handmatige Azure-configuratie

Deze stappen kan alleen jij uitvoeren (Azure/Entra-portaltoegang). De code in deze repo
is al voorbereid: zolang de onderstaande environment variables niet allemaal gezet zijn,
blijft de bestaande bcrypt/sessie-login gewoon werken (`isEntraConfigured()` schakelt
automatisch over zodra alles is ingevuld — zie `src/config/entra.js`).

## 1. Externe tenant aanmaken

Entra ID → Overview → **Manage tenants** → **Create** → **External** (niet "Workforce").
Kies een Azure-abonnement + resource group (of gebruik eerst de 30-dagen gratis trial).
Duurt tot ~30 minuten. Geen kosten voor het aanmaken zelf — billing is Monthly Active
Users (MAU)-based, eerste 50.000 MAU/maand gratis, daarna ± $0,03/MAU (live prijs
checken op de Azure-pricingpagina).

## 2. Twee app-registraties (bewust gescheiden, least privilege)

**a) `dpp-platform-web`** — voor de inlog-flow (delegated, gebruiker aanwezig)
- Platform: **Web**
- Redirect URI's: `https://<jouw-app-service>.azurewebsites.net/api/auth/entra/callback`
  en, voor lokaal ontwikkelen, `http://localhost:3000/api/auth/entra/callback`
  (`localhost` mag http zijn — de poort wordt genegeerd bij matching, maar Microsoft
  raadt aan dev/prod liever in aparte registraties te houden; voor MVP is één
  registratie met beide URI's acceptabel)
- Genereer een **client secret** (Certificates & secrets)
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

1. Maak twee security groups aan (Entra ID → Groups): bijv. `DPP-Standard-Users`.
2. Conditional Access → New policy:
   - **Include**: All users (dit is momenteel de enige optie in External-tenants)
   - **Exclude**: de groep `DPP-Standard-Users`
   - **Grant**: Require multifactor authentication
3. **Handmatig beheer voor MVP**: voeg elke nieuwe `company_user`/`viewer` toe aan
   `DPP-Standard-Users` (zij hebben dan GEEN verplichte MFA); laat `system_owner` en
   `company_admin`-accounts hier juist buiten (zij krijgen dan WEL verplichte MFA, via de
   Include-all-behalve-uitzondering).

   Ik heb dit bewust **niet** geautomatiseerd vanuit de DPP-backend: dat zou een extra
   Graph-permissie (`GroupMember.ReadWrite.All`, tenant-breed) vereisen puur voor een
   kleine, laagfrequente actie (alleen bij het aanmaken van company_admins). Voor MVP
   is dit met een paar accounts per maand een prima handmatige taak voor jou als
   System Owner. Zie het als een expliciete scope-keuze, niet een gat.

   **Let op — tijdelijk risico-venster:** een nieuwe `company_admin` heeft, tussen het
   moment van aanmaken in DPP en het moment dat jij ze uit `DPP-Standard-Users` haalt
   (of er nooit in stopt), nog geen verplichte MFA. Voeg daarom bij het aanmaken van een
   company_admin die groepswijziging het liefst *direct* door, niet als losse periodieke
   taak.

## 7. Password reset

- **Primair (aanbevolen door Microsoft, geen standing privilege nodig)**: schakel
  Self-Service Password Reset in bij Entra ID → **External Identities** → **Password
  reset**. Werkt met e-mail-OTP, geen extra kosten.
- **Fallback in DPP** (`POST /api/users/:id/reset-password`, al gebouwd): smalle
  Graph-permissie (`User-PasswordProfile.ReadWrite.All`), scoped door DPP's eigen
  company_id-check — bedoeld voor het geval een medewerker geen toegang meer heeft tot
  zijn e-mail. Niet de standaardweg.

## 8. Environment variables (App Service Application Settings + lokale `.env`)

```
ENTRA_TENANT_NAME=jouw-tenant-naam        (het stuk vóór .onmicrosoft.com / .ciamlogin.com)
ENTRA_TENANT_ID=...                        (Directory/tenant ID, beide app-registraties delen dezelfde tenant)
ENTRA_WEB_CLIENT_ID=...                    (van dpp-platform-web)
ENTRA_WEB_CLIENT_SECRET=...
ENTRA_GRAPH_CLIENT_ID=...                  (van dpp-platform-graph-service)
ENTRA_GRAPH_CLIENT_SECRET=...
ENTRA_REDIRECT_URI=https://.../api/auth/entra/callback
ENTRA_POST_LOGOUT_REDIRECT_URI=https://.../login.html
COOKIE_SECRET=...                          (willekeurige lange string, voor het signeren van de korte OIDC-state-cookie — GEEN Entra-secret, zelf te genereren, bv. met `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
```

Nooit in `.env` committen (staat al in `.gitignore`); op Azure als Application Settings.

## 9. Wat blijft ongewijzigd werken

Zolang bovenstaande niet (volledig) is ingevuld: `POST /api/auth/login` (bcrypt) blijft
100% functioneel voor bestaande accounts (zoals de gezaaide System Owner). Nieuwe
gebruikers aanmaken via `POST /api/users` valt in die situatie terug op het oude
wachtwoord-invoerveld. Zodra alle env vars gezet zijn, schakelt user-creation
automatisch over naar Entra-provisioning — er hoeft geen code aangepast te worden.
