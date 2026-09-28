const { HttpError } = require("../middleware/errorHandler");

// Route-ids komen uit de URL en zijn dus onbetrouwbaar. Alles wat geen positief geheel
// getal is, behandelen we als "bestaat niet" (404) — geen 400 met details erover.
function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    throw new HttpError(404, "Niet gevonden");
  }
  return id;
}

// Optioneel query-id (bijv. ?companyId=), undefined als niet opgegeven.
function parseOptionalId(value) {
  if (value === undefined || value === "") return undefined;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    throw new HttpError(400, "Ongeldig id");
  }
  return id;
}

module.exports = { parseId, parseOptionalId };
