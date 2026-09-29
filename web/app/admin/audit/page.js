"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 25;

const ACTION_VARIANTS = {
  login: "default",
  logout: "default",
  create: "success",
  update: "default",
  delete: "danger",
  publish: "success",
  impersonate_start: "warning",
  impersonate_stop: "warning"
};

function formatTimestamp(value) {
  return new Date(value).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "medium" });
}

export default function AuditPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (actionFilter) params.set("action", actionFilter);
      setData(await api.get(`/api/audit?${params}`));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Auditlog</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Actie
          <select
            value={actionFilter}
            onChange={(e) => {
              setPage(1);
              setActionFilter(e.target.value);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">Alle acties</option>
            <option value="login">Inloggen</option>
            <option value="logout">Uitloggen</option>
            <option value="create">Aanmaken</option>
            <option value="update">Bijwerken</option>
            <option value="delete">Verwijderen</option>
            <option value="publish">Publiceren</option>
            <option value="impersonate_start">Impersonatie gestart</option>
            <option value="impersonate_stop">Impersonatie gestopt</option>
            <option value="reset_password">Wachtwoordreset</option>
          </select>
        </label>
      </div>

      {error && <Card><p className="text-sm text-red-600">{error}</p></Card>}

      <Card>
        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState title="Geen auditregels" description="Er zijn geen regels die aan de filters voldoen." />
        ) : data ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4">Tijdstip</th>
                <th className="py-2 pr-4">Actie</th>
                <th className="py-2 pr-4">Entiteit</th>
                <th className="py-2 pr-4">Gebruiker</th>
                <th className="py-2 pr-4">Bedrijf</th>
                <th className="py-2">Impersonator</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-600">{formatTimestamp(row.timestamp)}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={ACTION_VARIANTS[row.action] || "default"}>{row.action}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-slate-700">
                    {row.entity_type}
                    {row.entity_id ? ` #${row.entity_id}` : ""}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{row.user_email || "—"}</td>
                  <td className="py-2 pr-4 text-slate-700">{row.company_name || "—"}</td>
                  <td className="py-2 text-amber-700">{row.impersonator_email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {data && data.total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              Pagina {page} van {totalPages} ({data.total} regels)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50"
              >
                Vorige
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50"
              >
                Volgende
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
