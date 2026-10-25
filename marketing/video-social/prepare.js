// Vult composition.html aan tot composition.final.html (logo en de echte QR-code naar
// www.veripasso.com) en schrijft timing.json (formaat en lengte).
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const [qrN, qrPath] = fs.readFileSync(path.join(dir, "qr-path.txt"), "utf8").split(/\r?\n/);
const iconPaths = `<path fill="#72E600" d="M34 42C20 52 18 72 27 91l78 145c8 15 29 16 38 1l24-42-68-132C85 36 55 27 34 42Z"/><path fill="#1476FF" d="M222 38c21-9 40 10 35 32l-31 142c-3 14-12 26-25 33l-59 31c-14 7-30-4-26-20l49-181c7-18 31-30 57-37Z"/><path fill="#FFFFFF" d="M174 91h47c7 0 12 5 12 12s-5 12-12 12h-47c-7 0-12-5-12-12s5-12 12-12Zm-10 45h48c7 0 12 5 12 12s-5 12-12 12h-48c-7 0-12-5-12-12s5-12 12-12Z"/>`;
const icon = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 280 280">${iconPaths}</svg>`;
let html = fs.readFileSync(path.join(dir, "composition.html"), "utf8")
  .split("__ICON22__").join(icon(28))
  .split("__QRN__").join(qrN.trim())
  .split("__QRPATH__").join(qrPath.trim());
if (/__[A-Z0-9_]+__/.test(html)) throw new Error("niet ingevuld: " + html.match(/__[A-Z0-9_]+__/)[0]);
fs.writeFileSync(path.join(dir, "composition.final.html"), html);
fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({ width: 1080, height: 1350, END: 36, bpm: 120 }, null, 2));
console.log("klaar");
