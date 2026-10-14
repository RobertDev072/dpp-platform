"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { roleLabel } from "@/lib/labels";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

// Gedeelde bouwstenen van Organisaties & gebruikers: rol- en soortbadges (altijd tekst
// én kleur), de server-side paginering en een hook die één gepagineerde lijst ophaalt.

export const PAGE_SIZES = [25, 50, 100];

const ROLE_CLASSES = {
  platform_owner: "bg-purple-100 text-purple-700",
  partner_admin: "bg-violet-100 text-violet-700",
  company_admin: "bg-blue-100 text-blue-700",
  company_user: "bg-slate-100 text-slate-600"
};

export function RoleBadge({ role }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_CLASSES[role] || ROLE_CLASSES.company_user}`}>
      {roleLabel(role)}
    </span>
  );
}

export function KindBadge({ kind, standalone = false }) {
  if (kind === "partner") {
    return <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">Partner</span>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
      {standalone ? "Zelfstandig klantbedrijf" : "Klantbedrijf"}
    </span>
  );
}

const COMPANY_STATUS = {
  active: ["success", "Actief"],
  blocked: ["danger", "Geblokkeerd"],
  suspended: ["warning", "Opgeschort"],
  archived: ["neutral", "Gearchiveerd"]
};

export function CompanyStatusBadge({ status }) {
  const [variant, label] = COMPANY_STATUS[status] || ["neutral", status];
  return <Badge variant={variant}>{label}</Badge>;
}

// Eén pagina van een server-side lijst. `url` null = (nog) niet laden, bijv. dichtgeklapt.
export function usePagedList(url, params, refreshKey = 0) {
  const [state, setState] = useState({ data: null, loading: Boolean(url), error: "" });
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    api
      .get(`${url}?${query}`)
      .then((data) => !cancelled && setState({ data, loading: false, error: "" }))
      .catch((err) => !cancelled && setState({ data: null, loading: false, error: err.message || "Laden mislukt" }));
    return () => {
      cancelled = true;
    };
  }, [url, query, refreshKey]);

  return state;
}

// Paginering met totaal, "Pagina X van Y", vorige/volgende en 25/50/100 per pagina.
export function Pager({ data, onPage, onPageSize, singular, plural, name }) {
  if (!data) return null;
  const { page, pages, total, pageSize } = data;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
      <span>
        {total} {total === 1 ? singular : plural} · Pagina {page} van {pages}
      </span>
      <div className="flex items-center gap-2">
        <label htmlFor={name} className="sr-only">
          Aantal per pagina
        </label>
        <select
          id={name}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} per pagina
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Vorige
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Volgende
        </Button>
      </div>
    </div>
  );
}

export function RowSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2 p-3" aria-busy="true" aria-label="Laden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-slate-100" />
      ))}
    </div>
  );
}

export function InlineError({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-xs font-medium underline hover:no-underline">
          Opnieuw proberen
        </button>
      )}
    </div>
  );
}
