"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

const STATUS_OPTIONS = ["active", "suspended", "archived"];

export default function CompaniesPage() {
  const toast = useToast();

  const [companies, setCompanies] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    Promise.all([api.get("/api/admin/plans"), api.get("/api/admin/companies")])
      .then(([planData, companyData]) => {
        setPlans(planData);
        setCompanies(companyData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handlePlanChange(company, value) {
    const planIdValue = value ? Number(value) : null;
    const previous = companies;
    // Optimistisch bijwerken: de select reageert meteen, de PATCH volgt op de achtergrond.
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, plan_id: planIdValue } : c)));
    try {
      await api.patch(`/api/admin/companies/${company.id}`, { planId: planIdValue });
    } catch (err) {
      setCompanies(previous);
      toast.error(err.message);
    }
  }

  async function handleStatusChange(company, value) {
    const previous = companies;
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, status: value } : c)));
    try {
      await api.patch(`/api/admin/companies/${company.id}`, { status: value });
    } catch (err) {
      setCompanies(previous);
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Bedrijven</h1>
        <Link
          href="/admin/companies/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Nieuw bedrijf
        </Link>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : companies.length === 0 ? (
          <EmptyState
            title="Nog geen bedrijven"
            description="Maak het eerste bedrijf aan via de knop Nieuw bedrijf."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">Naam</th>
                  <th className="py-2 pr-3">Slug</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{company.id}</td>
                    <td className="py-2 pr-3">{company.name}</td>
                    <td className="py-2 pr-3">{company.slug}</td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Plan van ${company.name}`}
                        value={company.plan_id ?? ""}
                        onChange={(e) => handlePlanChange(company, e.target.value)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      >
                        <option value="">— geen plan —</option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Status van ${company.name}`}
                        value={company.status}
                        onChange={(e) => handleStatusChange(company, e.target.value)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/admin/companies/${company.id}/uitnodigen`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        Admin uitnodigen
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
