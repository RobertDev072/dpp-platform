// Eén definitie van paspoort-compleetheid. De repository levert per product de
// losse criteria (checks) uit SQL; deze functie maakt er het percentage van. De
// SQL-filters (doc=compleet/incompleet) gebruiken dezelfde zeven criteria, en een
// product is alleen 100% als ze allemaal waar zijn - dus filter en score lopen
// nooit uiteen.
const COMPLETENESS_CHECKS = [
  "photo",
  "description",
  "category",
  "identification",
  "sustainability",
  "compliance",
  "documents"
];

function calculateProductCompleteness(checks = {}) {
  const passed = COMPLETENESS_CHECKS.filter((key) => Boolean(checks[key])).length;
  return Math.floor((passed * 100) / COMPLETENESS_CHECKS.length);
}

module.exports = { COMPLETENESS_CHECKS, calculateProductCompleteness };
