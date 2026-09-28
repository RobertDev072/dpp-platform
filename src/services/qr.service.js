const QRCode = require("qrcode");
const { getPublicBaseUrl } = require("../utils/publicUrl");

// QR-codes worden op aanvraag gegenereerd en niet opgeslagen: de inhoud is volledig af te
// leiden van public_id + PUBLIC_BASE_URL, dus opslag (Blob) zou alleen kosten toevoegen.

const QR_MIN_SIZE = 128;
const QR_MAX_SIZE = 1024;
const QR_DEFAULT_SIZE = 512;

// 'M' (~15% herstel) is een goede balans tussen dichtheid en leesbaarheid van een geprinte,
// mogelijk licht beschadigde sticker. Marge 2 modules: genoeg "quiet zone" voor scanners.
const QR_OPTIONS = Object.freeze({ margin: 2, errorCorrectionLevel: "M" });

function normalizePublicId(publicId) {
  return String(publicId).toLowerCase();
}

// Publieke pagina van een product. De basis-URL komt bij voorkeur uit PUBLIC_BASE_URL, zodat
// een gemanipuleerde Host-header nooit bepaalt waar een geprinte QR-code heen wijst.
function buildPublicUrl(req, publicId) {
  return `${getPublicBaseUrl(req)}/p/${normalizePublicId(publicId)}`;
}

// ?src=qr laat de publieke API een scan als "qr" registreren in plaats van "web".
function buildQrContent(req, publicId) {
  return `${buildPublicUrl(req, publicId)}?src=qr`;
}

function generatePng(content, size = QR_DEFAULT_SIZE) {
  return QRCode.toBuffer(content, { ...QR_OPTIONS, type: "png", width: size });
}

function generateSvg(content) {
  return QRCode.toString(content, { ...QR_OPTIONS, type: "svg" });
}

// Bestandsnaam voor Content-Disposition. Alleen [A-Za-z0-9_-]: een SKU is gebruikersinvoer
// en mag geen aanhalingstekens, puntkomma's of CR/LF in een header kunnen smokkelen.
function buildQrFilename(product, extension) {
  const fromSku = typeof product.sku === "string" ? product.sku.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) : "";
  const base = fromSku || `product-${Number(product.id)}`;
  return `dpp-qr-${base}.${extension}`;
}

module.exports = {
  QR_MIN_SIZE,
  QR_MAX_SIZE,
  QR_DEFAULT_SIZE,
  normalizePublicId,
  buildPublicUrl,
  buildQrContent,
  generatePng,
  generateSvg,
  buildQrFilename
};
