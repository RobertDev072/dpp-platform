const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

async function generateQrPngBuffer(url) {
  return QRCode.toBuffer(url, { type: "png", width: 512, margin: 1 });
}

async function generateQrSvgString(url) {
  return QRCode.toString(url, { type: "svg", margin: 1 });
}

function generateLabelPdfBuffer({ product, qrPngBuffer }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [227, 340], margin: 16 });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(14).text(product.name, { align: "center" });
      if (product.brand) {
        doc.fontSize(10).fillColor("#555555").text(product.brand, { align: "center" });
        doc.fillColor("#000000");
      }

      const qrSize = 180;
      const qrX = (doc.page.width - qrSize) / 2;
      doc.image(qrPngBuffer, qrX, 90, { width: qrSize, height: qrSize });

      doc
        .fontSize(9)
        .text("Scan voor productpaspoort", 0, 90 + qrSize + 12, { align: "center" });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generateQrPngBuffer, generateQrSvgString, generateLabelPdfBuffer };
