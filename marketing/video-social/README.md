# VeriPasso – socialevideo (LinkedIn / Instagram, 4:5)

Video van 36 seconden in 1080×1350 (staand, voor de feed). Er is geen voice-over: alleen
muziek, geluidseffecten en tekst in beeld. Iemand loopt naar een doos en scant de QR-code,
waarna het paspoort op de telefoon opent. Daarna volgen "Zo maak je het", "Zeker van je
zaak" en het logo met de oproep.

Alles draait in Chrome; ffmpeg is niet nodig.

| Bestand            | Wat                                                                |
|--------------------|--------------------------------------------------------------------|
| `composition.html` | animatie (GSAP, één tijdlijn, `window.seek(t)`)                    |
| `prepare.js`       | vult logo en QR in → `composition.final.html` + `timing.json`      |
| `render.mjs`       | `preview 2,9.5,…` (controlebeelden) · `frames` · `encode`          |
| `encode.html`      | muziek (120 BPM, Am–F–C–G, zelf gesynthetiseerd) + H.264/AAC → MP4 |
| `qr-path.txt`      | QR-code naar https://www.veripasso.com                             |

```
node prepare.js
node render.mjs preview 9.5,17.8,23.5   # controle
node render.mjs frames                  # 1080 beelden, 30 fps
node render.mjs encode                  # → VeriPasso-social-1080x1350.mp4
```
