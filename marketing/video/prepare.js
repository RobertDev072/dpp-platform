// Vult composition.html aan tot composition.final.html: voice-overtijden, ondertitels,
// logo en de echte QR-code (naar www.veripasso.com).
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const durations = JSON.parse(fs.readFileSync(path.join(dir, "voice", "durations.json"), "utf8").replace(/^﻿/, ""));
const starts = [1.0, 14.6, 18.8, 25.3, 32.6, 41.2, 48.8];
const END = 60;
const lines = fs.readFileSync(path.join(dir, "script.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim());

// Ondertitels: lange regels in twee delen.
const subs = [
  [1.0, 7.4, "Stap voor stap maakt de Europese Unie het digitale productpaspoort verplicht,"],
  [7.4, starts[0] + durations[0] + 0.2, "te beginnen met batterijen in 2027. Met VeriPasso ben je er klaar voor."]
];
for (let i = 1; i < 6; i++) subs.push([starts[i], starts[i] + durations[i] + 0.2, lines[i]]);
subs.push([starts[6], 52.6, "VeriPasso. Elk product zijn eigen paspoort."]);
subs.push([52.6, starts[6] + durations[6] + 0.3, "Vraag een demo aan op veripasso.com."]);

const [qrN, qrPath] = fs.readFileSync(path.join(dir, "qr-path.txt"), "utf8").split("\n");
const iconPaths = `<path fill="#72E600" d="M34 42C20 52 18 72 27 91l78 145c8 15 29 16 38 1l24-42-68-132C85 36 55 27 34 42Z"/><path fill="#1476FF" d="M222 38c21-9 40 10 35 32l-31 142c-3 14-12 26-25 33l-59 31c-14 7-30-4-26-20l49-181c7-18 31-30 57-37Z"/><path fill="#FFFFFF" d="M174 91h47c7 0 12 5 12 12s-5 12-12 12h-47c-7 0-12-5-12-12s5-12 12-12Zm-10 45h48c7 0 12 5 12 12s-5 12-12 12h-48c-7 0-12-5-12-12s5-12 12-12Z"/>`;
const icon = (size) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 280 280">${iconPaths}</svg>`;

let html = fs.readFileSync(path.join(dir, "composition.html"), "utf8");
html = html
  .replace("__VOICE_TIMES__", JSON.stringify(starts))
  .replace("__VOICE_DURATIONS__", JSON.stringify(durations))
  .replace("__END__", String(END))
  .replace("__SUBS__", JSON.stringify(subs))
  .split("__ICON120__").join(icon(120))
  .split("__ICON80__").join(icon(84))
  .split("__ICON40__").join(icon(40))
  .split("__ICON34__").join(icon(34))
  .split("__ICON30__").join(icon(30))
  .split("__QRN__").join(qrN.trim())
  .split("__QRPATH__").join(qrPath.trim());
// Cursor in de invulvelden alleen als het veld actief is.
html = html.replace(
  "  gsap.set('#laptop', { y: 160, scale: 0.92 });",
  "  gsap.set('#laptop', { y: 160, scale: 0.92 });\n  gsap.set('.caret', { autoAlpha: 0 });"
);
html = html.replace(
  "  tl.set('#in-email', { className: 'input focus' }, 15.0);",
  "  tl.set('#in-email', { className: 'input focus' }, 15.0).set('#caret-email', { autoAlpha: 1 }, 15.0).set('#caret-email', { autoAlpha: 0 }, 16.35).set('#caret-pass', { autoAlpha: 1 }, 16.35).set('#caret-pass', { autoAlpha: 0 }, 17.2);"
);
if (/__[A-Z0-9_]+__/.test(html)) throw new Error("niet alle plekken ingevuld: " + html.match(/__[A-Z0-9_]+__/)[0]);
fs.writeFileSync(path.join(dir, "composition.final.html"), html);
fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({ starts, durations, END, subs }, null, 2));
console.log("klaar; ondertitels:", subs.length, "eind:", END, "s");
