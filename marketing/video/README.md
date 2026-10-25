# Productvideo VeriPasso (1080p, 60 s)

Motion graphics in HTML/GSAP, beeld voor beeld opgenomen met Chrome en gecodeerd naar MP4
(H.264 + AAC) met WebCodecs. Geen ffmpeg nodig. Muziek wordt in de browser gegenereerd
(geen auteursrecht van derden); voice-over met de Windows-stem "Microsoft Frank" (nl-NL).

Stappen (Windows, in deze map):
1. Tekst aanpassen in `script.txt` (één regel per voice-overfragment).
2. `powershell -File tts.ps1` → `voice/*.wav` en `voice/durations.json`.
3. Starttijden zo nodig aanpassen in `prepare.js` (`starts`), dan `node prepare.js`.
4. `node render.mjs preview 3,16,28,38` → controlebeelden in `preview/`.
5. `node render.mjs frames` → 1800 beelden in `frames/`.
6. `node render.mjs encode` → `VeriPasso-productvideo-1080p.mp4`.

Andere stem (bijv. eigen opname of een professionele stem): zet WAV-bestanden in `voice/`
met dezelfde namen en werk `voice/durations.json` bij.
