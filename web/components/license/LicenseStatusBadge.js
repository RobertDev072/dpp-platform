import Badge from "@/components/ui/Badge";

// Licentiestatus (uit license.service.js) naar een VeriPasso-badge.
// "Verlopen" krijgt een klok-icoontje zodat het verschil met "Limiet bereikt"
// ook zonder kleur te zien is.

const STATUS_VARIANTS = {
  Actief: "success",
  "Bijna limiet": "warning",
  "Limiet bereikt": "danger",
  Verlopen: "danger"
};

function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mr-1 shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

export default function LicenseStatusBadge({ status }) {
  if (!status) {
    return null;
  }

  return (
    <Badge variant={STATUS_VARIANTS[status] || "neutral"}>
      {status === "Verlopen" && <ClockIcon />}
      {status}
    </Badge>
  );
}
