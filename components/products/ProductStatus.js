import Badge from "@/components/ui/Badge";

// Publicatieflow: Concept → Compleet (klaar om te publiceren) → Gepubliceerd → Gearchiveerd.
// "Compleet" is geen opgeslagen status maar wordt afgeleid uit de compleetheid: zo kan
// een product nooit per ongeluk publiek worden door alleen gegevens op te slaan.
export function productStage(product) {
  if (product.status === "archived") return "archived";
  if (product.status === "published") return "published";
  return (product.completeness ?? 0) >= 100 ? "complete" : "draft";
}

const STAGE = {
  draft: { label: "Concept", variant: "neutral" },
  complete: { label: "Compleet", variant: "info" },
  published: { label: "Gepubliceerd", variant: "success" },
  archived: { label: "Gearchiveerd", variant: "danger" }
};

export function ProductStageBadge({ product }) {
  const stage = STAGE[productStage(product)];
  return <Badge variant={stage.variant}>{stage.label}</Badge>;
}

// QR-status (zie productInsights.repository.js).
export function qrStatusOf(product) {
  if (product.qr_status) return product.qr_status;
  if (!product.public_id) return "none";
  if (product.status === "published") return "active";
  if (product.status === "archived") return "archived";
  return "reserved";
}

const QR = {
  none: { label: "Geen QR", variant: "neutral", help: "Nog geen QR-code" },
  reserved: { label: "QR klaar", variant: "warning", help: "QR bestaat en kan geprint worden; paspoort nog niet gepubliceerd" },
  active: { label: "QR actief", variant: "success", help: "Scannen toont het publieke paspoort" },
  archived: { label: "QR gearchiveerd", variant: "neutral", help: "Blijft werken; paspoort toont 'gearchiveerd'" }
};

export const QR_STATUS_OPTIONS = Object.entries(QR).map(([value, def]) => ({ value, label: def.label }));

export function QrStatusBadge({ product }) {
  const def = QR[qrStatusOf(product)];
  return (
    <span title={def.help}>
      <Badge variant={def.variant}>{def.label}</Badge>
    </span>
  );
}

// Stappen van de publicatieflow met de huidige stap gemarkeerd.
export function PublishStepper({ product }) {
  const stage = productStage(product);
  const steps = [
    { key: "draft", label: "Concept" },
    { key: "complete", label: "Compleet" },
    { key: "published", label: "Gepubliceerd" }
  ];
  const order = { draft: 0, complete: 1, published: 2, archived: 3 };
  if (stage === "archived") {
    return <p className="text-sm text-slate-500">Dit product is gearchiveerd. De QR-code blijft werken.</p>;
  }
  return (
    <ol className="flex items-center gap-2 text-xs sm:text-sm" aria-label="Publicatiestatus">
      {steps.map((step, index) => {
        const done = order[stage] > index;
        const current = order[stage] === index;
        return (
          <li key={step.key} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true" className={`h-px w-4 sm:w-8 ${done || current ? "bg-emerald-400" : "bg-slate-200"}`} />}
            <span
              aria-current={current ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                current ? "bg-emerald-600 text-white" : done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {done && <span aria-hidden="true">✓</span>}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
