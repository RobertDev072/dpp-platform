const { z } = require("zod");
const {
  PAPER_PRESETS,
  LAYOUT_PRESETS,
  MEDIA_TYPES,
  PRINTER_TYPES,
  TEMPLATE_PRESETS,
  TEMPLATE_ELEMENTS
} = require("../services/printLayout");

const enumOf = (obj) => z.enum(Object.keys(obj));
const mm = (min, max) => z.number().min(min).max(max);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Gebruik een kleur als #000000");

const settingsSchema = z.object({
  paper: z.object({
    preset: enumOf(PAPER_PRESETS),
    widthMm: mm(20, 1000),
    heightMm: mm(15, 1500),
    orientation: z.enum(["portrait", "landscape"])
  }),
  layout: z.object({
    preset: enumOf(LAYOUT_PRESETS),
    columns: z.number().int().min(1).max(10),
    rows: z.number().int().min(1).max(20),
    marginTopMm: mm(0, 100),
    marginRightMm: mm(0, 100),
    marginBottomMm: mm(0, 100),
    marginLeftMm: mm(0, 100),
    gapXMm: mm(0, 50),
    gapYMm: mm(0, 50)
  }),
  media: z.object({
    type: enumOf(MEDIA_TYPES),
    weightGsm: z.number().int().min(30).max(1000).nullable().optional(),
    finish: z.string().max(100).optional()
  }),
  printer: z.object({ type: enumOf(PRINTER_TYPES) }),
  qr: z.object({
    sizeMm: mm(5, 300),
    errorCorrection: z.enum(["L", "M", "Q", "H"]),
    quietZoneModules: z.number().int().min(0).max(10),
    color: hexColor,
    background: hexColor,
    caption: z.string().max(80)
  }),
  template: z.object({
    preset: enumOf(TEMPLATE_PRESETS),
    elements: z.object(Object.fromEntries(Object.keys(TEMPLATE_ELEMENTS).map((k) => [k, z.boolean().optional()])))
  }),
  export: z.object({
    format: z.enum(["pdf", "png", "svg"]),
    dpi: z.number().int().min(150).max(1200)
  })
});

const printProfileSchema = z.object({
  name: z.string().trim().min(1, "Geef het profiel een naam").max(100),
  purpose: z.string().trim().max(200).optional().nullable(),
  isDefault: z.boolean().optional(),
  settings: settingsSchema
});

const updatePrintProfileSchema = printProfileSchema.partial().refine((d) => Object.keys(d).length > 0, {
  message: "Geen velden om bij te werken"
});

module.exports = { printProfileSchema, updatePrintProfileSchema, settingsSchema };
