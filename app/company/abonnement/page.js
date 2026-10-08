"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import SubscriptionUsage from "@/components/license/SubscriptionUsage";

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
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Huidig abonnement</h2>
              <SubscriptionUsage usage={license} />
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
