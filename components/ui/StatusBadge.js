import Badge from "./Badge";

// Productstatus (draft/published/archived) en QR-status. Compleetheid is bewust géén
// status: die staat los als percentage (ProductCompleteness / CompletenessBar).
export const PRODUCT_STATUS_LABELS = {
  draft: "Concept",
  published: "Gepubliceerd",
  archived: "Gearchiveerd"
};

const PRODUCT_STATUS_VARIANTS = {
  draft: "neutral",
  published: "success",
  archived: "warning"
};

export const QR_STATUS_LABELS = {
  active: "Actief",
  reserved: "Gereserveerd",
  none: "Geen QR"
};

export const QR_STATUS_HELP = {
  active: "De QR-code is actief: scannen opent het openbare productpaspoort.",
  reserved: "De QR-code bestaat al en kan geprint worden, maar wordt pas actief na publiceren.",
  none: "Er is nog geen QR-code voor dit product."
};

const QR_STATUS_VARIANTS = {
  active: "success",
  reserved: "info",
  none: "neutral"
};

export default function StatusBadge({ status }) {
  return <Badge variant={PRODUCT_STATUS_VARIANTS[status] || "neutral"}>{PRODUCT_STATUS_LABELS[status] || status}</Badge>;
}

export function QrStatusBadge({ status }) {
  return (
    <span title={QR_STATUS_HELP[status]}>
      <Badge variant={QR_STATUS_VARIANTS[status] || "neutral"}>{QR_STATUS_LABELS[status] || status}</Badge>
    </span>
  );
}
