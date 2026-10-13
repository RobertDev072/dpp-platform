const QRCode = require("qrcode");

// Foutcorrectie "Q" (±25% herstelbaar): een QR-code op een verpakking blijft scanbaar
// met krassen, vuil of een stukje logo erover. De inhoud (de permanente paspoort-URL)
// is hetzelfde als bij eerder gedownloade codes; alleen het patroon is robuuster.
const QR_OPTIONS = { errorCorrectionLevel: "Q", margin: 2 };

async function generateQrPngBuffer(url, { width = 512 } = {}) {
  return QRCode.toBuffer(url, { ...QR_OPTIONS, type: "png", width });
}

async function generateQrSvgString(url) {
  return QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
}

module.exports = { generateQrPngBuffer, generateQrSvgString };
