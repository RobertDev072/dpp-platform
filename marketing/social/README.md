# Social posts (LinkedIn + Instagram)

`posts.json` bevat per dag de post: tekst (`caption`), hashtags, link en de tekst op de
afbeelding. `node render.mjs` maakt daarvan:

- `out/NN-datum.png`: afbeelding 1080×1350 (4:5, feedformaat van LinkedIn en Instagram);
- `kalender.md`: per dag de tekst om te kopiëren.

De eigenaar plaatst de posts zelf. Op LinkedIn de link in de eerste reactie, op
Instagram in de bio. Stijlen: `statement`, `countdown`, `myth`, `question`, `list`,
`timeline`, `founder`, `tip`, `feature` (zie `card.html`).

Spelregels zoals voor de blog (`content/blog/README.md`): feiten kloppen, bronnen, geen
onjuiste claims over VeriPasso.
