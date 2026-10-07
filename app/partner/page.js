"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import AdminStatTile from "@/components/admin/AdminStatTile";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";

// Reseller-dashboard: alleen klanttenants en hun licentiestatus — bewust geen
// enkel product-, document- of gebruikerselement in dit gebied.
export default function PartnerDashboardPage() {
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

  const loading = !stats && !error;
  const customers = stats?.customers ?? [];
  const totals = stats?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Overzicht</h1>
          <p className="mt-1 text-sm text-slate-500">
            Beheer je klantbedrijven en hun licenties{stats?.companyName ? ` namens ${stats.companyName}` : ""}.
          </p>
        </div>
        <Link
          href="/partner/klanten/nieuw"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Nieuw klantbedrijf
        </Link>
      </div>

      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <Skeleton className="h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        totals && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <AdminStatTile label="Mijn klanten" value={totals.customers} />
            <AdminStatTile label="Actieve licenties" value={totals.active} tone="success" />
            <AdminStatTile label="Bijna limiet" value={totals.nearLimit} tone="warning" />
            <AdminStatTile label="Verlopen" value={totals.expired} tone="danger" />
          </div>
        )
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Klantbedrijven</h2>
          <Link
            href="/partner/klanten"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Naar Mijn klanten →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            title="Nog geen klantbedrijven"
            description="Maak je eerste klantbedrijf aan via de knop Nieuw klantbedrijf."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Bedrijf</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-slate-900">{customer.name}</p>
                      <p className="text-xs text-slate-500">{customer.slug}</p>
                    </td>
                    <td className="py-2.5 pr-3">
                      {customer.plan ? (
                        <Badge variant="info">{customer.plan.name}</Badge>
                      ) : (
                        <Badge variant="neutral">Geen plan</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <LicenseStatusBadge status={customer.status} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/partner/klanten/${customer.id}`}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        Bekijken
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
