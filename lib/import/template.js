import { TEMPLATE_COLUMNS, IMPORT_FIELDS } from "@/src/services/importFields";
import { downloadCsv, downloadXlsx } from "@/lib/download";

const SECOND_EXAMPLE = {
  product_name: "Eettafel Bergen",
  sku: "ET-BERGEN-180",
  gtin: "8712345678913",
  brand: "VeriPasso Home",
  manufacturer: "Meubelfabriek BV",
  category: "Tafels",
  country_of_origin: "Duitsland",
  material: "Gerecycled staal",
  recycled_material_percentage: 80,
  carbon_footprint_kg: 61,
  recyclable: "ja",
  reach_compliant: "ja",
  rohs_compliant: "nee",
  ce_marked: "nee",
  description: ""
};

export function downloadTemplateCsv() {
  downloadCsv(
    "veripasso-import-template.csv",
    TEMPLATE_COLUMNS.map((c) => c.header),
    [TEMPLATE_COLUMNS.map((c) => c.example), TEMPLATE_COLUMNS.map((c) => SECOND_EXAMPLE[c.header] ?? "")]
  );
}

export async function downloadTemplateXlsx() {
  const header = TEMPLATE_COLUMNS.map((c) => ({ value: c.header, fontWeight: "bold", backgroundColor: "#D1FAE5" }));
  const label = (key) => IMPORT_FIELDS.find((f) => f.key === key);
  await downloadXlsx("veripasso-import-template.xlsx", [
    {
      sheet: "Producten",
      data: [header, TEMPLATE_COLUMNS.map((c) => c.example), TEMPLATE_COLUMNS.map((c) => SECOND_EXAMPLE[c.header] ?? null)],
      columns: TEMPLATE_COLUMNS.map((c) => ({ width: Math.max(14, c.header.length + 4) })),
      stickyRowsCount: 1
    },
    {
      sheet: "Instructies",
      data: [
        [
          { value: "Kolom", fontWeight: "bold" },
          { value: "Veld in VeriPasso", fontWeight: "bold" },
          { value: "Verplicht", fontWeight: "bold" },
          { value: "Toelichting", fontWeight: "bold" }
        ],
        ...TEMPLATE_COLUMNS.map((c) => [c.header, label(c.field)?.label || c.field, label(c.field)?.required ? "ja" : "nee", c.help]),
        [null],
        ["Tips"],
        ["• Eén product per rij. Laat de kopregel staan; de volgorde van kolommen maakt niet uit."],
        ["• Eigen kolomnamen (bijv. 'Artikelnummer', 'EAN', 'Producent') worden bij het importeren herkend of kun je zelf koppelen."],
        ["• Bestaat een product al (zelfde SKU of GTIN)? Bij het importeren kies je: overslaan, bijwerken of nieuw aanmaken."],
        ["• Geïmporteerde producten worden als concept aangemaakt; publiceren doe je daarna bewust."]
      ],
      columns: [{ width: 30 }, { width: 28 }, { width: 10 }, { width: 70 }]
    }
  ]);
}
