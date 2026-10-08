"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatValidity } from "@/components/license/licenseFormat";

// Zelfde drempels als de waarschuwing op het Overzicht: rood bij blokkade
// (verlopen of limiet bereikt), amber wanneer een limiet in zicht komt.
function LicenseWarning({ license }) {
  const maxPct = Math.max(license.users.pct ?? 0, license.products.pct ?? 0);
  const expired = license.status === "Verlopen";

  if (expired || maxPct >= 100) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {expired
          ? "Abonnement verlopen — nieuwe medewerkers/producten aanmaken is geblokkeerd. Neem contact op met de beheerder."
          : "Limiet bereikt — nieuwe medewerkers/producten aanmaken is geblokkeerd. Neem contact op met de beheerder."}
      </div>
    );
  }
  if (maxPct >= 80) {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        Je nadert de limiet van je abonnement.
      </div>
    );
  }
  return null;
}

// Abonnementspagina van het eigen bedrijf: plan, geldigheid en verbruik.
// Wijzigingen lopen via VeriPasso of je partner — hier alleen inzage.
export default function AbonnementPage() {
  const [license, setLicense] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/company/license")
      .then((data) => {
        if (!cancelled) {
          setLicense(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !license && !error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Abonnement</h1>
        <p className="mt-1 text-sm text-slate-500">
          Het plan, de geldigheid en het verbruik van je organisatie.
        </p>
      </div>

      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}

      {loading ? (
        <Card>
          <Skeleton className="h-40 w-full" />
        </Card>
      ) : (
        license && (
          <>
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Huidig abonnement</h2>
                <LicenseStatusBadge status={license.status} />
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Plan</dt>
                  <dd className="mt-1">
                    {license.plan ? (
                      <Badge variant="info">{license.plan.name}</Badge>
                    ) : (
                      <Badge variant="neutral">Geen plan</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Geldigheid</dt>
                  <dd className="mt-1 text-sm text-slate-700">
                    {formatValidity(license.licenseStart, license.licenseEnd)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <UsageBar label="Gebruikers" {...license.users} />
                <UsageBar label="Producten" {...license.products} />
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Nog beschikbaar:{" "}
                {license.products.max == null ? "onbeperkt" : Math.max(0, license.products.max - license.products.used).toLocaleString("nl-NL")} producten
                {" · "}
                {license.users.max == null ? "onbeperkt" : Math.max(0, license.users.max - license.users.used).toLocaleString("nl-NL")} gebruikers. Gearchiveerde producten tellen niet mee.
              </p>

              <div className="mt-4 empty:hidden">
                <LicenseWarning license={license} />
              </div>
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Abonnement wijzigen?</h2>
              <p className="text-sm text-slate-600">
                Neem contact op met VeriPasso of je partner om het plan of de geldigheid aan te
                passen.
              </p>
            </Card>
          </>
        )
      )}
    </div>
  );
}
