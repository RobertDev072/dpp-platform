const { z } = require("zod");

const updateComplianceSchema = z.object({
  ceMarked: z.boolean().nullable().optional(),
  applicableRegulations: z.array(z.string().min(1).max(200)).max(50).nullable().optional()
});

module.exports = { updateComplianceSchema };
