# Bewaartermijnenbeleid VeriPasso

> CONCEPT, stand 2026-10-20. Kolom "Nu in de software" beschrijft wat de software op dit moment
> doet. Kolom "Beleid" is wat je kiest; waar die verschillen, moet de software worden aangepast.

| Gegevens | Nu in de software | Beleid | Reden |
|---|---|---|---|
| Losse paspoortbezoeken (scans) | 90 dagen, daarna alleen dagtotalen (automatisch) | 90 dagen | inzicht voor de klant; minimaal nodig |
| Dagtotalen scans | onbeperkt, zonder persoonsgegevens | onbeperkt | geen persoonsgegevens |
| Gebruikersaccount | tot het account wordt verwijderd of gedeactiveerd | [BESLUIT: na einde contract of verwijdering binnen 30 dagen verwijderen/anonimiseren] | uitvoering overeenkomst |
| Inlogsessies | maximaal 8 uur geldig; opruimen verlopen sessies [INVULLEN: controleren] | [BESLUIT: verlopen sessies na 30 dagen wissen] | beveiliging |
| Logboek van handelingen (audit) | [INVULLEN: controleren] | [BESLUIT: 2 jaar] | beveiliging en bewijs; hashketen van paspoortversies blijft |
| Paspoortversies (productgegevens) | bewaard, onveranderlijk (hashketen) | zolang het paspoort moet bestaan; [BESLUIT: minimaal de wettelijke termijn per productgroep, vaak 10 jaar] | wettelijke eisen DPP (ESPR) |
| Gearchiveerde producten/bedrijven | gearchiveerd, later definitief verwijderd [INVULLEN: termijn controleren] | [BESLUIT] | |
| Uitnodigingslinks | 48 uur geldig | 48 uur | beveiliging |
| Reservekopie op de server | 7 dagen | 7 dagen | herstel |
| Reservekopie Cloudflare R2 | [INVULLEN: controleren levenscyclusregel] | [BESLUIT: 30 dagen] | herstel |
| Reservekopie Hetzner | 30 dagen | 30 dagen | herstel |
| Serversnapshots | 10 stuks (dagelijks) | 10 dagen | herstel |
| Serverlogboeken (Docker/Caddy) | [INVULLEN: controleren logrotatie] | [BESLUIT: 14 dagen] | storingen oplossen |
| Contactberichten/e-mail | in de mailbox | [BESLUIT: 2 jaar na laatste contact] | |
| Administratie (facturen, contracten) | buiten de software | 7 jaar | fiscale bewaarplicht |

## Verwijderen in reservekopieën
Gegevens die uit de applicatie zijn verwijderd, verdwijnen uit de reservekopieën zodra die zijn
verlopen (uiterlijk na de langste termijn hierboven, [INVULLEN: 30] dagen). Wordt een
reservekopie teruggezet, dan worden eerder verwijderde gegevens direct opnieuw verwijderd.

## Herziening
Dit beleid wordt jaarlijks gecontroleerd. Volgende controle: [INVULLEN: datum].
