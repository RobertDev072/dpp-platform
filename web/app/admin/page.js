"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";

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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      {stats && (
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
      )}
    </div>
  );
}
