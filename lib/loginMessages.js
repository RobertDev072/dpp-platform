// Duidelijke meldingen op de inlogpagina: een korte titel en wat je kunt doen. Bewust geen
// melding "dit e-mailadres bestaat niet": dan kan iedereen aftasten wie er een account
// heeft (de server geeft voor onbekend adres en verkeerd wachtwoord dezelfde code).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Controle vóór het versturen: lege velden of een e-mailadres zonder @ of domein.
function validateLogin({ email, password }) {
  const value = String(email || "").trim();
  if (!value && !password) return { title: "Vul je e-mailadres en wachtwoord in.", hint: null, field: "email" };
  if (!value) return { title: "Vul je e-mailadres in.", hint: null, field: "email" };
  if (!EMAIL_PATTERN.test(value)) return { title: "Dit is geen geldig e-mailadres.", hint: "Controleer het adres, bijvoorbeeld naam@bedrijf.nl.", field: "email" };
  if (!password) return { title: "Vul je wachtwoord in.", hint: null, field: "password" };
  return null;
}

// Fout van de API (of van het netwerk) → { title, hint }.
function loginErrorMessage(error) {
  if (!error || error.name === "TypeError" || error.message === "Failed to fetch") {
    return { title: "Geen verbinding met VeriPasso.", hint: "Controleer je internetverbinding en probeer het opnieuw." };
  }
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return {
        title: "E-mailadres of wachtwoord klopt niet.",
        hint: "Let op hoofdletters en spaties. Nog geen account of wachtwoord vergeten? Je beheerder kan je uitnodigen of een tijdelijk wachtwoord geven."
      };
    case "ACCOUNT_INACTIVE":
      return { title: "Je account is geblokkeerd of niet meer actief.", hint: "Neem contact op met de beheerder van je bedrijf." };
    case "RATE_LIMITED":
      return { title: "Te veel inlogpogingen.", hint: error.message || "Wacht even en probeer het daarna opnieuw." };
    case "TEMP_PASSWORD_EXPIRED":
      return { title: "Je tijdelijke wachtwoord is verlopen.", hint: "Het is 24 uur geldig. Vraag je beheerder om een nieuw tijdelijk wachtwoord." };
    case "MFA_INVALID":
      return { title: "Deze code klopt niet.", hint: "Gebruik de code die je app nu toont. Staat de tijd op je telefoon goed?" };
    case "MFA_TICKET_INVALID":
      return { title: "De verificatie is verlopen.", hint: "Log opnieuw in met je e-mailadres en wachtwoord." };
    default:
      if (error.status === 400) return { title: "Controleer je invoer.", hint: error.message || null };
      if (error.status >= 500) return { title: "Er ging iets mis bij VeriPasso.", hint: "Probeer het over een paar minuten opnieuw." };
      return { title: error.message || "Inloggen is niet gelukt.", hint: null };
  }
}

module.exports = { validateLogin, loginErrorMessage, EMAIL_PATTERN };
