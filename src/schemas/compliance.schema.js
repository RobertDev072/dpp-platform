const { z } = require("zod");

const updateComplianceSchema = z.object({
  ceMarked: z.boolean().optional(),
  applicableRegulations: z.array(z.string().min(1).max(200)).optional()
});

module.exports = { updateComplianceSchema };
