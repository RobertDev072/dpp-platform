// Leest een gegenereerde Data Matrix-PNG echt terug met een onafhankelijke decoder
// (ZXing), zodat tests bewijzen dat de code scanbaar is en de juiste inhoud heeft.
const { PNG } = require("pngjs");
const { DataMatrixReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource } = require("@zxing/library");

function decodeDataMatrixPng(buffer) {
  const png = PNG.sync.read(buffer);
  const luminance = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < luminance.length; i += 1) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    luminance[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  const source = new RGBLuminanceSource(luminance, png.width, png.height);
  try {
    return new DataMatrixReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
  } catch {
    return null;
  }
}

module.exports = { decodeDataMatrixPng };
