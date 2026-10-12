// Maakt/actualiseert het Platform Owner-account uit SYSTEM_OWNER_* in .env
// (zie src/db/ownerSeed.js). Daarna die variabelen weer uit .env halen.
//   npm run seed:owner
const { seedSystemOwner } = require("../src/db/ownerSeed");
const { close } = require("../src/config/db");

seedSystemOwner({
  email: process.env.SYSTEM_OWNER_EMAIL,
  password: process.env.SYSTEM_OWNER_PASSWORD,
  firstName: process.env.SYSTEM_OWNER_FIRST_NAME || null,
  lastName: process.env.SYSTEM_OWNER_LAST_NAME || null
})
  .then(async (result) => {
    console.log(result.created ? `✅ System Owner aangemaakt: ${result.email}` : `✅ Bestaande System Owner bijgewerkt: ${result.email}`);
    await close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Seed mislukt:");
    console.error(error.message);
    await close();
    process.exit(1);
  });
