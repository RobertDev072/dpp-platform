const QRCode = require("qrcode");
const bwipjs = require("bwip-js");

// QR-code (ISO/IEC 18004). Foutcorrectie "Q" (±25% herstelbaar): een QR-code op een
// verpakking blijft scanbaar met krassen, vuil of een stukje logo erover. Vrije ruimte
// ("quiet zone") van 4 modules aan elke kant, zoals ISO/IEC 18004 voorschrijft. De
// inhoud (de permanente paspoort-URL) en het patroon zelf zijn hetzelfde als bij eerder
// gedownloade codes; alleen de witte rand eromheen is breder.
const QR_QUIET_ZONE_MODULES = 4;
const QR_OPTIONS = { errorCorrectionLevel: "Q", margin: QR_QUIET_ZONE_MODULES };

async function generateQrPngBuffer(url, { width = 512 } = {}) {
  return QRCode.toBuffer(url, { ...QR_OPTIONS, type: "png", width });
}

async function generateQrSvgString(url) {
  return QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
}

// Data Matrix ECC 200 (ISO/IEC 16022): kleiner dan een QR-code bij dezelfde inhoud, geschikt
// voor kleine onderdelen en directe markering (laser, inkjet). Inhoud: dezelfde permanente
// paspoort-URL als de QR-code, of een GS1 Digital Link. bwip-js tekent een module als 2
// eenheden; padding 4 = vrije ruimte van 2 modules (ISO/IEC 16022: minimaal 1).
const DM_QUIET_ZONE_UNITS = 4;
const DM_BASE = { bcid: "datamatrix", padding: DM_QUIET_ZONE_UNITS, backgroundcolor: "FFFFFF" };

function generateDataMatrixSvgString(text) {
  return bwipjs.toSVG({ ...DM_BASE, text, scale: 4 });
}

// width: gewenste breedte in pixels; de schaal is een geheel getal zodat elke module scherp is.
async function generateDataMatrixPngBuffer(text, { width = 512 } = {}) {
  const probe = await bwipjs.toBuffer({ ...DM_BASE, text, scale: 1 });
  const unitWidth = probe.readUInt32BE(16);
  const scale = Math.max(1, Math.min(40, Math.floor(width / unitWidth)));
  return bwipjs.toBuffer({ ...DM_BASE, text, scale });
}

module.exports = {
  QR_QUIET_ZONE_MODULES,
  generateQrPngBuffer,
  generateQrSvgString,
  generateDataMatrixSvgString,
  generateDataMatrixPngBuffer
};
