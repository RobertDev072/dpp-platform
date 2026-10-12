// Leest gegenereerde QR-codes echt terug (zoals een telefooncamera), zodat tests
// bewijzen dat een code scanbaar is én de juiste URL bevat, in plaats van alleen te
// controleren dat er "een afbeelding" terugkomt.
const jsQR = require("jsqr");
const { PNG } = require("pngjs");

function decodeRgba(data, width, height) {
  const result = jsQR(new Uint8ClampedArray(data), width, height);
  return result ? result.data : null;
}

function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return decodeRgba(png.data, png.width, png.height);
}

// SVG van de qrcode-bibliotheek: viewBox "0 0 N N" en één pad met horizontale
// lijnstukken (M x y / m dx dy / h len) per donkere module-rij. Dat pad wordt hier
// teruggerekend naar een pixelraster en daarna gescand.
function decodeSvg(svg, scale = 8) {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const pathMatch = /<path stroke="[^"]+" d="([^"]+)"/.exec(svg);
  if (!viewBox || !pathMatch) return null;
  const size = Number(viewBox[1]);
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const tokens = pathMatch[1].match(/[MmHh]|-?\d*\.?\d+/g);
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++];
    if (cmd === "M") {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
    } else if (cmd === "m") {
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    } else if (cmd === "h" || cmd === "H") {
      const len = Number(tokens[i++]);
      const row = Math.floor(y);
      for (let c = 0; c < len; c++) {
        if (dark[row] && x + c < size) dark[row][Math.floor(x + c)] = true;
      }
      x += len;
    }
  }
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let py = 0; py < width; py++) {
    for (let px = 0; px < width; px++) {
      const v = dark[Math.floor(py / scale)][Math.floor(px / scale)] ? 0 : 255;
      const o = (py * width + px) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return decodeRgba(data, width, width);
}

module.exports = { decodePng, decodeSvg };
