# DPP Platform — rollen, autorisatie en pagina-architectuur

Dit document is de bron van waarheid voor rollen, permissies, API-contracten en de
pagina-indeling. Code en document horen overeen te komen; wijzig ze samen.

## 1. Uitgangspunten

- **Multi-tenant.** Elke `company_admin`/medewerker hoort bij precies één `company_id`
  (afgedwongen door `CHK_Users_RoleCompany`). De `system_owner` hoort bij geen company.
- **Tenant-scope komt altijd uit de sessie** (`req.user.companyId`), nooit uit de request
  body/query. Alleen de System Owner mag een `companyId` meegeven (filter/doel).
- **Cross-tenant = 404**, nooit 403 (verraadt niet dat een record bestaat).
  Gebruik `assertCompanyAccess(user, record.company_id)` uit `src/utils/tenant.js`.
- **Autorisatie op de backend.** Routes checken permissies met
  `requirePermission(PERMISSIONS.X)` (`src/middleware/auth.js`). De frontend krijgt de
  permissielijst via `/api/auth/me` en verbergt alleen menu's/knoppen.
- **Identity = Entra External ID, autorisatie = Azure SQL.** Rollen, company_id,
  licenties en status staan in `dbo.Users`/`dbo.Companies`. Entra levert alleen de
  geverifieerde identiteit (`sub`). Zonder Entra-config valt de app terug op lokale
  bcrypt-login (alleen voor lokale ontwikkeling).
- **Geen betaalde features.** Geen Azure Blob (documenten = HTTPS-links), geen e-mailservice
  (activatielinks en tijdelijke wachtwoorden worden één keer getoond aan de beheerder),
  geen Front Door / custom domain / P1/P2.

## 2. Rollen en permissies

Bron: `src/auth/permissions.js`.

| Permissie | SO | Company Admin | Product Mgr | Compliance Mgr | Medewerker | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `platform:manage` (bedrijven, plannen, invites, alle users) | ✓ | | | | | |
| `platform:audit` | ✓ | | | | | |
| `company:dashboard` | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `company:settings` | | ✓ | | | | |
| `company:audit` | | ✓ | | | | |
| `users:manage` (eigen company) | | ✓ | | | | |
| `reports:read` | | ✓ | ✓ | ✓ | | |
| `products:read` | ✓ (support, alleen lezen) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `products:create` | | ✓ | ✓ | | ✓ | |
| `products:update` (algemene velden) | | ✓ | ✓ | | ✓ | |
| `products:compliance` (compliancevelden) | | ✓ | ✓ | ✓ | | |
| `products:submit_review` (draft → review) | | ✓ | ✓ | ✓ | ✓ | |
| `products:publish` | | ✓ | ✓ | | | |
| `products:archive` | | ✓ | ✓ | | | |
| `documents:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `documents:manage` | | ✓ | ✓ | ✓ | ✓ | |
| `qr:download` | | ✓ | ✓ | | ✓ | |

Rollen die een Company Admin mag toekennen (`ASSIGNABLE_BY_COMPANY_ADMIN`):
`product_manager`, `compliance_manager`, `company_user`, `viewer`. Een Company Admin kan
**geen** `company_admin` of `system_owner` aanmaken, wijzigen of resetten, en geen
`company_id` meegeven. Nieuwe Company Admins lopen via de uitnodigingsflow van de System
Owner (met MFA via Conditional Access).

Gebruikersstatus: `active` (telt als seat), `inactive` (gedeactiveerd), `blocked`
(geblokkeerd, bijv. bij misbruik). Alleen `active` mag inloggen. Bij elke statuswijziging
weg van `active`, elke rolwijziging en elke wachtwoord-reset worden alle sessies van die
gebruiker ingetrokken (`revokeUserSessions`) en wordt het Entra-account (best effort)
uit-/aangezet.

Company-status: `active`, `suspended` (= gedeactiveerd), `archived`. Gebruikers van een
niet-actieve company kunnen niet inloggen en bestaande sessies werken direct niet meer
(check in `getUserForToken`).

## 3. Licenties / seats

- Effectieve limiet: `COALESCE(Companies.max_users, Plans.max_users)`; beide NULL = geen limiet.
- `activeUsers` = users met `status = 'active'`. `remainingSeats = maxUsers - activeUsers`.
- Nieuwe user **of heractiveren** (inactive/blocked → active) of een uitnodiging accepteren:
  `activeUsers < maxUsers`, anders `409 { code: "LICENSE_LIMIT_REACHED" }`.
  De autoritatieve check gebeurt in een transactie met `UPDLOCK, HOLDLOCK`.
- Alleen de System Owner wijzigt plan en `max_users`.
- Helper: `getSeatUsage(companyId)` in `src/services/seats.service.js`.

## 4. Productstatus

```
draft ──submit_review──▶ review ──publish──▶ published
  ▲                        │                    │
  └──── (terugsturen) ─────┘◀──(depubliceren)───┘
draft/review/published ──archive──▶ archived ──(herstellen)──▶ draft
```

| Van → naar | Permissie | Extra |
|---|---|---|
| draft → review | `products:submit_review` | |
| review → draft | `products:submit_review` of `products:publish` | terugsturen |
| draft/review → published | `products:publish` | checklist moet slagen, anders `422 PUBLISH_REQUIREMENTS_MISSING` |
| published → draft | `products:publish` | publieke pagina geeft dan 404; `public_id` blijft behouden (QR blijft geldig bij herpubliceren) |
| draft/review/published → archived | `products:archive` | |
| archived → draft | `products:archive` | |
| overig | — | `409 INVALID_TRANSITION` |

Verplichte velden voor publiceren: `name`, `sku`, `manufacturer`, `model`, `category`,
`materials`, `countryOfOrigin`. Aanbevolen (waarschuwing, blokkeert niet):
`complianceInfo`, `recyclingInfo`, `repairInfo`, minstens één publiek document.

Bij de eerste publicatie krijgt het product een `public_id` (UUID) en `published_at`.
Publieke URL: `${PUBLIC_BASE_URL}/p/<public_id>`; de QR-code bevat `…/p/<public_id>?src=qr`.

## 5. Company Admin-uitnodiging

1. System Owner maakt een company aan (`POST /api/admin/companies`).
2. System Owner maakt een invite (`POST /api/admin/companies/:id/invitations`).
   Backend genereert 32 random bytes (base64url), slaat alleen `sha256(token)` op, expiry 72 uur.
   Eerdere openstaande invites voor hetzelfde e-mailadres + company worden ingetrokken.
3. Response bevat éénmalig `activationUrl = ${PUBLIC_BASE_URL}/activate.html#token=<token>`.
   Het token staat in het **fragment** (`#`): dat wordt nooit naar een server gestuurd en
   komt dus niet in access logs of Referer-headers. De System Owner deelt de link zelf.
4. De activatiepagina leest het fragment, wist het direct uit de adresbalk
   (`history.replaceState`) en stuurt het token alleen in een POST-body.
5. Accepteren: invite moet bestaan, niet verlopen/ingetrokken/gebruikt, company actief,
   e-mail nog niet in gebruik, seat vrij. Dan:
   - Entra geconfigureerd: Graph maakt de External ID-identity aan met het door de admin
     gekozen wachtwoord (`forceChangePasswordNextSignIn: false`), lokale user krijgt
     `entra_object_id` en geen `password_hash`.
   - Lokaal (dev): bcrypt-hash van het gekozen wachtwoord.
   - In één transactie: invite atomair consumeren
     (`UPDATE … WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now`)
     + user insert met seat-lock. `company_id` en `role` komen uit de invite-rij, nooit uit
     de request → een invite kan niet cross-tenant worden gebruikt.
   - Faalt de transactie na het aanmaken van een Entra-account, dan wordt dat account best
     effort uitgeschakeld.
6. De admin logt daarna gewoon in; MFA wordt afgedwongen door de Conditional Access-policy
   in Entra (zie `docs/entra-external-id-setup.md` §6). Company Admins horen **niet** in de
   groep `DPP-Standard-Users`.

## 6. Medewerker aanmaken (Company Admin)

`POST /api/users` — seat-check, e-mail uniek, Entra-identity via Graph met gegenereerd
tijdelijk wachtwoord (`forceChangePasswordNextSignIn: true`), lokale user met juiste
`company_id`. Response bevat het tijdelijke wachtwoord **één keer** (`Cache-Control:
no-store`); het wordt nergens opgeslagen (Entra-modus) of alleen als bcrypt-hash (lokale
modus). De UI toont het in een "eenmalig tonen"-dialoog. Geen uitnodigingsmail.

## 7. Audit logging

`logAudit({ companyId, userId, action, entityType, entityId, metadata })` — kolommen:
`user_id` = actor, `entity_type` = target_type, `entity_id` = target_id. Metadata wordt
automatisch ontdaan van sleutels die op wachtwoorden/secrets/tokens/codes/hashes lijken.

Acties: `login`, `logout`, `create`, `update`, `activate`, `deactivate`, `block`,
`role_change`, `plan_change`, `seat_limit_change`, `archive`, `submit_review`,
`publish`, `unpublish`, `status_change`, `qr_generate`, `reset_password`,
`invite_create`, `invite_revoke`, `invite_accept`, `document_create`, `document_update`,
`document_delete`.

## 8. API-overzicht

Alle bodies JSON (camelCase in requests). Responses zijn DB-rijen in snake_case tenzij
anders vermeld. Fouten: `{ error: { message, details?, code? } }`.
Ids in de URL worden geparsed met `parseId` (`src/utils/params.js`): ongeldig → 404.

### Auth (`src/routes/auth.routes.js`, `src/routes/entraAuth.routes.js`)

| Methode | Pad | Wie | Beschrijving |
|---|---|---|---|
| GET | `/api/auth/config` | publiek | `{ mode: "entra" \| "local" }` |
| POST | `/api/auth/login` | publiek, rate-limited | lokale login `{email,password}` → `{ id, email, role, companyId, redirectTo }` |
| POST | `/api/auth/logout` | ingelogd | 204 |
| GET | `/api/auth/me` | ingelogd | `{ id, companyId, companyName, email, firstName, lastName, role, permissions[] }` |
| POST | `/auth/login` | publiek | form-post `{ email }` → 302 naar Entra met `login_hint` |
| GET | `/auth/login` | publiek | idem zonder login_hint |
| POST | `/auth/redirect` | Entra callback | 302 naar `/admin/index.html` (SO) of `/app/index.html`; fout → `/login.html?error=<code>` |
| GET | `/auth/logout` | ingelogd | 302 naar Entra-logout |

`redirectTo`: `/admin/index.html` voor system_owner, anders `/app/index.html`.
Foutcodes op `/login.html?error=`: `login_failed`, `no_account`, `inactive`, `state`.

### Platform (System Owner, `platform:manage`)

| Methode | Pad | Beschrijving |
|---|---|---|
| GET | `/api/admin/stats` | dashboard-widgets (zie hieronder) |
| GET | `/api/admin/settings` | platformconfiguratie-status, **geen secrets** |
| GET | `/api/admin/companies` | lijst incl. `plan_name`, `max_users`, `effective_max_users`, `active_users`, `product_count`, `admin_count`, `pending_invitations` |
| POST | `/api/admin/companies` | `{ name, slug?, kvkNumber?, country?, address?, contactName?, contactEmail?, planId?, maxUsers?, status? }` |
| GET | `/api/admin/companies/:id` | detail + `seats` + `admins[]` + `invitations[]` |
| PATCH | `/api/admin/companies/:id` | dezelfde velden, alle optioneel |
| POST | `/api/admin/companies/:id/invitations` | `{ email, firstName?, lastName? }` → `{ invitation, activationUrl }` (no-store) |
| GET | `/api/admin/companies/:id/invitations` | invites van die company |
| GET | `/api/admin/invitations?status=` | alle invites (`pending`/`accepted`/`revoked`/`expired`) incl. `company_name` |
| POST | `/api/admin/invitations/:id/revoke` | intrekken |
| POST | `/api/admin/invitations/:id/resend` | oude intrekken + nieuwe link → `{ invitation, activationUrl }` |
| GET | `/api/admin/plans` | plannen incl. `company_count` |
| POST | `/api/admin/plans` | `{ name, description?, maxUsers, maxProducts, isActive? }` |
| PATCH | `/api/admin/plans/:id` | idem, optioneel |
| GET | `/api/audit?companyId=&action=&entityType=&limit=&offset=` | `platform:audit` → `{ items[], total }` |

`GET /api/admin/stats` →
```
{ companies: { total, active }, users: { total, active },
  licenses: { activeLicenses, totalSeats, usedSeats },
  products: { total, draft, review, published, archived }, dpps: { published },
  scans: { total, last30Days }, invitations: { pending },
  recentCompanies: [ { id, name, status, created_at } ],
  recentActivity: [ { id, timestamp, action, entity_type, entity_id, company_name, actor_email } ] }
```
`activeLicenses` = actieve companies met een plan of eigen `max_users`.

Invite-status (berekend): `accepted` als `accepted_at`, anders `revoked` als `revoked_at`,
anders `expired` als `expires_at < now`, anders `pending`.

### Uitnodiging activeren (publiek, rate-limited, token alleen in body)

| Methode | Pad | Beschrijving |
|---|---|---|
| POST | `/api/invitations/lookup` | `{ token }` → `{ companyName, email, firstName, lastName, expiresAt, mode }`; ongeldig → `404 INVITE_INVALID` |
| POST | `/api/invitations/accept` | `{ token, password, firstName?, lastName? }` → `{ email, redirectTo: "/login.html" }` |

Wachtwoordeisen: minimaal 12 tekens, hoofdletter, kleine letter, cijfer en symbool
(voldoet aan de Entra-complexiteitseisen).

### Gebruikers (`users:manage` voor Company Admin — eigen company; `platform:manage` voor SO)

| Methode | Pad | Beschrijving |
|---|---|---|
| GET | `/api/users?companyId=&role=&status=` | lijst; `companyId` alleen voor SO. Rijen: `id, company_id, company_name, email, first_name, last_name, role, status, identity ("entra"\|"local"), last_login_at, created_at` |
| GET | `/api/users/:id` | één user |
| POST | `/api/users` | `{ email, firstName?, lastName?, role, status?, companyId? (SO), password? (alleen lokale modus) }` → user + eenmalig `tempPassword` |
| PATCH | `/api/users/:id` | `{ firstName?, lastName?, role?, status? }` |
| POST | `/api/users/:id/reset-password` | → `{ tempPassword }` (no-store) |

Regels: eigen account niet deactiveren/rol wijzigen (`400 CANNOT_MODIFY_SELF`); Company
Admin mag alleen `ASSIGNABLE_BY_COMPANY_ADMIN`-rollen toekennen en alleen users met zo'n
rol wijzigen (anders 403; andere company → 404); rol `system_owner` nooit via deze API
toe te kennen of weg te halen; e-mail in gebruik → `409 EMAIL_IN_USE`; company niet actief →
`409 COMPANY_INACTIVE`.

### Eigen company (`src/routes/company.routes.js`, scope = sessie)

| Methode | Pad | Permissie | Beschrijving |
|---|---|---|---|
| GET | `/api/company` | `company:dashboard` | `{ id, name, kvk_number, country, address, contact_name, contact_email, status, plan: {id,name}\|null, seats: {maxUsers, activeUsers, remainingSeats} }` |
| PATCH | `/api/company` | `company:settings` | `{ address?, country?, contactName?, contactEmail? }` (naam, KvK, plan, seats, status: alleen SO) |
| GET | `/api/company/dashboard` | `company:dashboard` | `{ users: {total, active, inactive, blocked}, seats, products: {total, draft, review, published, archived}, scans: {total, last30Days}, recentActivity[] }` (`recentActivity` alleen met `company:audit`, anders `[]`) |
| GET | `/api/company/reports` | `reports:read` | `{ productsByStatus[], productsByCategory[], scansByDay[] (30 dagen), topProducts[], incomplete[] }` |
| GET | `/api/company/audit?limit=&offset=&action=` | `company:audit` | `{ items[], total }` |

### Producten, documenten, QR (`products:*`, `documents:*`, `qr:download`)

| Methode | Pad | Beschrijving |
|---|---|---|
| GET | `/api/products?status=&q=&category=&companyId=` | lijst (companyId alleen SO); rijen incl. `public_url` indien gepubliceerd en (SO) `company_name` |
| POST | `/api/products` | `{ name, sku?, manufacturer?, brand?, model?, gtin?, category?, description?, countryOfOrigin?, materials?, complianceInfo?, recyclingInfo?, repairInfo?, adminNotes? }` |
| GET | `/api/products/:id` | detail incl. `created_by_email`, `public_url` |
| PATCH | `/api/products/:id` | zelfde velden; geen `status`. Veld zonder permissie → `403 FIELD_NOT_PERMITTED`; gearchiveerd → `409 PRODUCT_ARCHIVED` |
| DELETE | `/api/products/:id` | = archiveren (`products:archive`) |
| POST | `/api/products/:id/status` | `{ status }` volgens §4 |
| GET | `/api/products/:id/checklist` | `{ ready, items: [{ field, label, ok, level: "required"\|"recommended" }] }` |
| GET | `/api/products/:id/qr.png?size=&download=1` | PNG (alleen gepubliceerd, anders `409 NOT_PUBLISHED`) |
| GET | `/api/products/:id/qr.svg?download=1` | SVG |
| GET | `/api/products/:id/documents` | documenten van het product |
| POST | `/api/products/:id/documents` | `{ title, type, language?, url (https), isPublic }` |
| GET | `/api/documents?productId=&type=` | alle documenten van de eigen company incl. `product_name` |
| PATCH | `/api/documents/:id` | `{ title?, type?, language?, url?, isPublic? }` |
| DELETE | `/api/documents/:id` | 204 |

Compliancevelden (`products:compliance`): `materials`, `countryOfOrigin`, `complianceInfo`,
`recyclingInfo`, `repairInfo`. `adminNotes` = `products:update`. Overige velden = `products:update`.
Documenttypes: `manual`, `certificate`, `declaration`, `safety`, `repair`, `recycling`, `other`.
Alleen `?download=1` op de QR-endpoints schrijft een `qr_generate`-audit en zet
`Content-Disposition: attachment` (voorvertoning niet).

### Publiek (geen login)

| Methode | Pad | Beschrijving |
|---|---|---|
| GET | `/p/:publicId` | mobiel-first DPP-pagina (`public/dpp.html`), 404 bij ongeldige UUID |
| GET | `/api/public/dpp/:publicId?src=qr` | whitelisted DTO; alleen `status = 'published'`; registreert een ScanEvent |

Publieke DTO (camelCase, **alleen** deze velden):
```
{ publicId, name, brand, manufacturer, model, sku, gtin, category, description,
  materials, countryOfOrigin, complianceInfo, recyclingInfo, repairInfo,
  issuer (bedrijfsnaam), publishedAt, updatedAt,
  documents: [ { title, type, language, url } ]   // alleen is_public = 1
}
```
Nooit: `id`, `company_id`, `created_by`/`updated_by`, `admin_notes`, audit-data,
niet-publieke documenten. ScanEvent: `product_id`, tijdstip, `source` (`qr`/`web`),
user-agent (max 500), referrer **alleen origin**, `country_code` alleen als een vertrouwde
proxy-header is geconfigureerd. Nooit IP-adressen of cookies.

## 9. Pagina's

| Omgeving | Pad | Voor |
|---|---|---|
| Login | `/login.html` | iedereen — DPP-branding, geen "Inloggen met Microsoft"-knop |
| Activatie | `/activate.html#token=…` | uitgenodigde Company Admin |
| System Owner | `/admin/index.html`, `companies.html`, `company.html?id=`, `company-admins.html`, `users.html`, `plans.html`, `products.html`, `audit.html`, `settings.html` | `system_owner` |
| Company | `/app/index.html`, `products.html`, `product.html?id=`, `users.html`, `documents.html`, `qr.html`, `reports.html`, `settings.html` | company-rollen, menu gefilterd op permissies |
| Publiek | `/p/<public_id>` | iedereen |

Frontend-bouwstenen: `public/js/api.js` (fetch-wrapper), `public/js/dom.js`
(`DPP.el`, `renderTable`, `openModal`, `showSecretOnce`, …), `public/js/layout.js`
(`DPP.initPage()` = auth-check + sidebar/topbar + omgevings-guard), `public/css/styles.css`.
Regels: geen inline `<script>`/`style=""` (CSP), geen `innerHTML` met data, alle tekst via
`textContent`. Dynamische breedtes via `element.style.width = …` (CSSOM mag wel onder CSP).

### Login met Entra External ID

De DPP-loginpagina toont altijd de DPP-huisstijl. In Entra-modus vraagt stap 1 het
e-mailadres en post dat naar `/auth/login`; Entra toont daarna de wachtwoordstap (met
"Wachtwoord vergeten?" via SSPR). Die pagina krijgt de DPP-huisstijl via **Company
branding** in de External ID-tenant (gratis). Een volledig eigen wachtwoordformulier kan
later via Entra's *native authentication* API; dat is een aparte stap. Zie
`docs/entra-external-id-setup.md`.
