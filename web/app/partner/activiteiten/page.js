"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";

// NL-omschrijvingen per auditactie; onbekende acties tonen we gewoon zoals ze
// binnenkomen, zodat nieuwe backend-acties nooit "verdwijnen".
function describeActivity(row) {
  if (row.action === "create" && row.entity_type === "Company") {
    return "Klantbedrijf aangemaakt";
  }
  if (row.action === "invite_created") {
    return "Uitnodiging verstuurd";
  }
  if (row.action === "invite_revoked") {
    return "Uitnodiging ingetrokken";
  }
  if (row.action === "reset_password") {
    return "Wachtwoord gereset";
  }
  if (row.action === "update") {
    return "Gewijzigd";
  }
  return row.action;
}

const ACTION_VARIANTS = {
  create: "success",
  invite_created: "info",
  invite_revoked: "neutral",
  reset_password: "warning",
  update: "neutral"
};

// metadata komt als JSON-string (of null) uit de API; ongeldig JSON negeren we.
function parseMetadata(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatTimestamp(value) {
  return new Date(value).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

// Activiteitenoverzicht van de partner: de eigen acties (klanten, uitnodigingen,
// wachtwoordresets) — nooit de audit-historie van klantbedrijven zelf.
export default function ActiviteitenPage() {
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/partner/activity")
      .then((data) => {
        if (!cancelled) {
          setActivity(data);
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

  const loading = !activity && !error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Activiteiten</h1>
        <p className="mt-1 text-sm text-slate-500">
          Recente acties van jouw partnerorganisatie: aangemaakte klanten, uitnodigingen en
          wachtwoordresets.
        </p>
      </div>

      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (activity || []).length === 0 ? (
          <EmptyState
            title="Nog geen activiteiten"
            description="Zodra je klanten aanmaakt of uitnodigingen verstuurt, verschijnen die hier."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((row) => {
              const metadata = parseMetadata(row.metadata);
              const targetEmail = metadata?.targetEmail;
              const failed = metadata?.result === "mislukt";
              return (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={ACTION_VARIANTS[row.action] || "neutral"}>
                        {describeActivity(row)}
                      </Badge>
                      {failed && <Badge variant="danger">Mislukt</Badge>}
                      {row.company_name && (
                        <span className="text-sm font-medium text-slate-900">
                          {row.company_name}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Door {row.actor_email || "onbekend"}
                      {targetEmail ? ` — betreft ${targetEmail}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">
                    {formatTimestamp(row.timestamp)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
