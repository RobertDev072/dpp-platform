// Geldigheid van de verificatie in het EU DPP-register: die verloopt als het
// identificatiemiddel (het zegel) verloopt, en uiterlijk 3 jaar na de eerste verificatie
// (Uitvoeringsverordening (EU) 2026/1778; Battery FAQ van de Commissie, vraag 6.2).
// Gedeeld door de app (Bedrijfsinstellingen, registerkaart) en de server (meldingen).

const REMINDER_DAYS = 60;

function toDate(value) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addYears(date, years) {
  const copy = new Date(date.getTime());
  copy.setUTCFullYear(copy.getUTCFullYear() + years);
  return copy;
}

// { verifiedAt, sealExpiresAt } (datums of JJJJ-MM-DD) → vroegste vervaldatum (JJJJ-MM-DD)
// en hoeveel dagen dat nog is; null als er niets is ingevuld.
function verificationExpiry({ verifiedAt, sealExpiresAt }, now = new Date()) {
  const candidates = [];
  const verified = toDate(verifiedAt);
  const seal = toDate(sealExpiresAt);
  if (verified) candidates.push({ date: addYears(verified, 3), reason: "3 jaar na de verificatie" });
  if (seal) candidates.push({ date: seal, reason: "vervaldatum van het zegel" });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.date - b.date);
  const first = candidates[0];
  const today = toDate(now);
  const daysLeft = Math.round((first.date - today) / 86400000);
  return {
    expiresOn: first.date.toISOString().slice(0, 10),
    reason: first.reason,
    daysLeft,
    expired: daysLeft < 0,
    remind: daysLeft <= REMINDER_DAYS
  };
}

module.exports = { REMINDER_DAYS, verificationExpiry };
