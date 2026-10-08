import Badge from "@/components/ui/Badge";
import UsageBar from "./UsageBar";
import LicenseStatusBadge from "./LicenseStatusBadge";
import { formatBytes, formatPrice, formatValidity } from "./licenseFormat";

// Abonnement in één blok: plan + prijs, geldigheid, verbruik (producten, gebruikers,
// opslag, QR-scans deze maand) en waarschuwingen. Verwacht de vorm van
// getExtendedUsage (server); ontbrekende extra's worden gewoon weggelaten.
export default function SubscriptionUsage({ usage }) {
  if (!usage) return null;
  const price = formatPrice(usage.priceMonthlyCents);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">
            {usage.plan ? usage.plan.name : "Geen plan"}
            {price && <span className="ml-2 text-sm font-normal text-slate-500">— {price}</span>}
          </p>
          <p className="text-sm text-slate-500">Geldigheid: {formatValidity(usage.licenseStart, usage.licenseEnd)}</p>
        </div>
        <LicenseStatusBadge status={usage.status} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <UsageBar label="Producten" {...usage.products} />
        <UsageBar label="Gebruikers" {...usage.users} />
        {usage.storage && <UsageBar label="Opslag" {...usage.storage} format={formatBytes} />}
        {usage.scans && <UsageBar label="QR-scans deze maand" {...usage.scans} unlimitedLabel="geen limiet" />}
      </div>
      {usage.warnings?.length > 0 && (
        <ul className="space-y-1.5">
          {usage.warnings.map((w) => (
            <li
              key={w.message}
              role="alert"
              className={`rounded-lg border px-3 py-2 text-sm ${
                w.level === "danger" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}
      {usage.scans && (
        <p className="text-xs text-slate-500">
          QR-codes blijven altijd werken, ook boven een scanlimiet; opslag en scans zijn informatief.
        </p>
      )}
      {!usage.plan && <Badge variant="neutral">Zonder plan gelden geen limieten</Badge>}
    </div>
  );
}
