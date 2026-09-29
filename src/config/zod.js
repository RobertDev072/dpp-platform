const { z } = require("zod");

// Nederlandse standaardmeldingen voor alle Zod-validaties ("Verplicht", typefouten,
// min/max) - domeinspecifieke teksten worden per veld overschreven in de schema's.
z.config(z.locales.nl());

module.exports = { z };
