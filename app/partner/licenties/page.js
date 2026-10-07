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
import { formatValidity } from "@/components/license/licenseFormat";

// Licentie-inzage per klant: plan, geldigheid, verbruik en status. Alleen
// lezen — plannen en geldigheid wijzigt de Platform Owner.
export default function KlantlicentiesPage() {
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
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Klantlicenties</h1>
        <p className="mt-1 text-sm text-slate-500">
          Plan, geldigheid en verbruik per klantbedrijf.
        </p>
      </div>

      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (customers || []).length === 0 ? (
          <EmptyState
            title="Nog geen klantbedrijven"
            description="Zodra je klantbedrijven hebt, zie je hier hun licenties."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Klant</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Geldigheid</th>
                  <th className="py-2 pr-3 font-medium">Gebruikers</th>
                  <th className="py-2 pr-3 font-medium">Producten</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-3">
                      <Link
                        href={`/partner/klanten/${customer.id}`}
                        className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        {customer.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-3">
                      {customer.plan ? (
                        <Badge variant="info">{customer.plan.name}</Badge>
                      ) : (
                        <Badge variant="neutral">Geen plan</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-slate-600">
                      {formatValidity(customer.licenseStart, customer.licenseEnd)}
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
