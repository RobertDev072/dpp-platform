"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function DocumentenPage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get("/api/company/documents")
      .then((data) => setDocuments(Array.isArray(data) ? data : []))
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return documents;
    }
    return documents.filter(
      (doc) =>
        (doc.title || "").toLowerCase().includes(term) ||
        (doc.product_name || "").toLowerCase().includes(term)
    );
  }, [documents, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Documenten</h1>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoeken op titel of product..."
          aria-label="Zoeken op titel of product"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            title="Nog geen documenten"
            description="Documenten die je aan producten toevoegt verschijnen hier automatisch."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Geen documenten gevonden"
            description={`Geen documenten gevonden voor "${search.trim()}".`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3">Titel</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Type / Categorie</th>
                  <th className="py-2 pr-3">Taal</th>
                  <th className="py-2 pr-3">Openbaar</th>
                  <th className="py-2 pr-3">Datum</th>
                  <th className="py-2">Actie</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => (
                  <tr key={doc.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{doc.title || "—"}</td>
                    <td className="py-2 pr-3">
                      {doc.product_id ? (
                        <Link
                          href={`/company/products/${doc.product_id}`}
                          className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                        >
                          {doc.product_name || "Bekijk product"}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {[doc.type, doc.category].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="py-2 pr-3 uppercase text-slate-600">{doc.language || "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={doc.is_public ? "success" : "neutral"}>
                        {doc.is_public ? "Openbaar" : "Privé"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{formatDate(doc.created_at)}</td>
                    <td className="py-2">
                      {doc.storage_url ? (
                        <a
                          href={doc.storage_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                        >
                          Openen
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
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
