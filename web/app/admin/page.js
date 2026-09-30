"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import EmptyState from "@/components/ui/EmptyState";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { usageSummary } from "@/components/license/licenseFormat";

export default function AdminDashboardPage() {
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

  const licenseAlerts = stats?.licenseAlerts ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile label="Bedrijven" value={stats.companies} />
            <StatTile label="Actieve bedrijven" value={stats.activeCompanies} />
            <StatTile label="Actieve gebruikers" value={stats.activeUsers} />
            <StatTile label="Producten (concept)" value={stats.products.draft} />
            <StatTile label="Gepubliceerde DPP's" value={stats.products.published} />
            <StatTile label="Gearchiveerd" value={stats.products.archived} />
            <StatTile label="QR-scans" value={stats.qrScans} />
            <StatTile label="Openstaande invites" value={stats.pendingInvites} />
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Licenties die aandacht vragen
              </h2>
              <Link
                href="/admin/licenses"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Naar abonnementen →
              </Link>
            </div>

            {licenseAlerts.length === 0 ? (
              <EmptyState title="Alle licenties zijn gezond ✔" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {licenseAlerts.map((alert) => (
                  <li
                    key={alert.companyId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {alert.name}
                      </span>
                      <LicenseStatusBadge status={alert.status} />
                    </div>
                    <span className="text-xs text-slate-500">{usageSummary(alert)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
