const { z } = require("zod");

const startResetSchema = z.object({ email: z.string().email() });
const continueTokenSchema = z.object({ continuationToken: z.string().min(1) });
const submitCodeSchema = z.object({
  continuationToken: z.string().min(1),
  code: z.string().min(1)
});
const submitPasswordSchema = z.object({
  continuationToken: z.string().min(1),
  password: z.string().min(12, "Wachtwoord moet minimaal 12 tekens zijn"),
  code: z.string().min(1),
  // Optioneel, alleen voor UX: na een geslaagde zelfbedieningsreset vervalt een
  // eventuele gedwongen-wijziging-vlag, zodat de eerstvolgende login niet nóg een
  // wijziging afdwingt.
  email: z.string().email().optional()
});

module.exports = { startResetSchema, continueTokenSchema, submitCodeSchema, submitPasswordSchema };
