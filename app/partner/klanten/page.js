"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatDateNL } from "@/components/license/licenseFormat";

// Volledig klantenoverzicht van de partner: alle eigen klantbedrijven met plan,
// geldigheid, verbruik en licentiestatus. Nieuwe klanten start je hiervandaan.
export default function MijnKlantenPage() {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/partner/customers")
      .then((data) => {
        if (!cancelled) {
          setCustomers(data);
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

  const loading = !customers && !error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mijn klanten</h1>
          <p className="mt-1 text-sm text-slate-500">
            Alle klantbedrijven die je als partner beheert.
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

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (customers || []).length === 0 ? (
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
                  <th className="py-2 pr-3 font-medium">Geldig tot</th>
                  <th className="py-2 pr-3 font-medium">Gebruikers</th>
                  <th className="py-2 pr-3 font-medium">Producten</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-3">
                      <p className="font-medium text-slate-900">{customer.name}</p>
                      <p className="text-xs text-slate-500">{customer.slug}</p>
                    </td>
                    <td className="py-3 pr-3">
                      {customer.plan ? (
                        <Badge variant="info">{customer.plan.name}</Badge>
                      ) : (
                        <Badge variant="neutral">Geen plan</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-slate-600">
                      {formatDateNL(customer.licenseEnd) || "—"}
                    </td>
                    <td className="py-3 pr-3">
                      <UsageBar label="Gebruikers" {...customer.users} />
                    </td>
                    <td className="py-3 pr-3">
                      <UsageBar label="Producten" {...customer.products} />
                    </td>
                    <td className="py-3 pr-3">
                      <LicenseStatusBadge status={customer.status} />
                    </td>
                    <td className="py-3 pr-3">
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
