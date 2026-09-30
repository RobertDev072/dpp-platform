"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatValidity } from "@/components/license/licenseFormat";

// Waarschuwingsbanner bij de licentiekaart: rood bij blokkade (limiet bereikt of
// verlopen), oranje/amber wanneer een limiet in zicht komt. Verbruik en limieten
// gelden alleen voor dit bedrijf.
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
  if (maxPct >= 90) {
    return (
      <div role="alert" className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700">
        Je nadert de limiet van je abonnement.
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

export default function CompanyDashboardPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/dashboard/stats")
      .then((data) => {
        if (!cancelled) {
          setStats(data);
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

  const license = stats?.license;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Overzicht</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      {stats && (
        <>
          <div className="text-sm text-slate-600">
            {stats.companyName} {stats.planName ? `— plan ${stats.planName}` : ""}
          </div>

          {license && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Abonnement</h2>
                <LicenseStatusBadge status={license.status} />
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {license.plan ? license.plan.name : "Geen plan"}
                {" · "}
                Geldigheid: {formatValidity(license.licenseStart, license.licenseEnd)}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <UsageBar label="Gebruikers" {...license.users} />
                <UsageBar label="Producten" {...license.products} />
              </div>
              <div className="mt-4 empty:hidden">
                <LicenseWarning license={license} />
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile label="Actieve gebruikers" value={stats.activeUsers} />
            <StatTile label="Max. gebruikers" value={stats.maxUsers ?? "-"} />
            <StatTile label="Producten (concept)" value={stats.products.draft} />
            <StatTile label="Gepubliceerde DPP's" value={stats.products.published} />
            <StatTile label="Gearchiveerd" value={stats.products.archived} />
            <StatTile label="QR-scans" value={stats.qrScans} />
          </div>
        </>
      )}
    </div>
  );
}
