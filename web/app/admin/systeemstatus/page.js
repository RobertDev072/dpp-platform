"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";

// Statusindicator in de handgetekende iconenstijl: groen vinkje = aanwezig/ok,
// rood kruisje = ontbreekt.
function StatusIcon({ ok }) {
  if (ok) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-emerald-600"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.5" />
        <path d="m6.5 10.3 2.4 2.4 4.6-5.2" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-red-600"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="m7.2 7.2 5.6 5.6M12.8 7.2l-5.6 5.6" />
    </svg>
  );
}

// Eén regel in een statuskaart: label + waarde (of aanwezig/ontbreekt-indicator).
function StatusRow({ label, ok, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right">
        {value ? (
          <code className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
            {value}
          </code>
        ) : (
          <span className={`text-xs font-medium ${ok ? "text-emerald-700" : "text-red-600"}`}>
            {ok ? "Aanwezig" : "Ontbreekt"}
          </span>
        )}
        <StatusIcon ok={ok} />
      </span>
    </div>
  );
}

function SectionBadge({ ok, okLabel, notOkLabel }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
      }`}
    >
      <StatusIcon ok={ok} />
      {ok ? okLabel : notOkLabel}
    </span>
  );
}

// Systeemstatus voor de Platform Owner: welke Entra-configuratie en basis-URL's
// draaien er op deze omgeving. Toont uitsluitend niet-geheime identifiers;
// secrets alleen als aanwezig/ontbreekt (dat dwingt de API ook af).
export default function SysteemstatusPage() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/admin/config-status")
      .then((data) => {
        if (!cancelled) {
          setStatus(data);
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

  const loading = !status && !error;
  const entra = status?.entra;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Systeemstatus</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configuratie van deze omgeving: Microsoft Entra en basis-URL&apos;s. Geheimen worden
          nooit getoond, alleen of ze aanwezig zijn.
        </p>
      </div>

      {error && <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Skeleton className="h-40 w-full" />
          </Card>
          <Card>
            <Skeleton className="h-40 w-full" />
          </Card>
        </div>
      ) : (
        entra && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">Entra — inloggen</h2>
                  <SectionBadge
                    ok={entra.loginConfigured}
                    okLabel="Geconfigureerd"
                    notOkLabel="Niet volledig"
                  />
                </div>
                <div className="divide-y divide-slate-100">
                  <StatusRow label="Tenantnaam" ok={Boolean(entra.tenantName)} value={entra.tenantName} />
                  <StatusRow label="Tenant-id" ok={Boolean(entra.tenantId)} value={entra.tenantId} />
                  <StatusRow
                    label="Web client-id"
                    ok={Boolean(entra.webClientId)}
                    value={entra.webClientId}
                  />
                  <StatusRow label="Web client-secret" ok={entra.webClientSecretSet} />
                </div>
                {entra.missingLoginVars?.length > 0 && (
                  <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                    Ontbrekende variabelen: {entra.missingLoginVars.join(", ")}
                  </p>
                )}
              </Card>

              <Card>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Entra Graph — gebruikersprovisioning
                  </h2>
                  <SectionBadge
                    ok={entra.graphConfigured}
                    okLabel="Geconfigureerd"
                    notOkLabel="Niet volledig"
                  />
                </div>
                <div className="divide-y divide-slate-100">
                  <StatusRow
                    label="Graph client-id"
                    ok={Boolean(entra.graphClientId)}
                    value={entra.graphClientId}
                  />
                  <StatusRow label="Graph client-secret" ok={entra.graphClientSecretSet} />
                </div>
                {entra.missingGraphVars?.length > 0 && (
                  <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                    Ontbrekende variabelen: {entra.missingGraphVars.join(", ")}
                  </p>
                )}
              </Card>
            </div>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Basis-URL&apos;s</h2>
              <div className="divide-y divide-slate-100">
                <StatusRow
                  label="App-basis-URL (APP_BASE_URL)"
                  ok={Boolean(status.appBaseUrl)}
                  value={status.appBaseUrl}
                />
                <StatusRow
                  label="QR-basis-URL (QR_BASE_URL)"
                  ok={Boolean(status.qrBaseUrl)}
                  value={status.qrBaseUrl}
                />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Deze URL&apos;s bepalen welke hostnaam in activatielinks en op QR-codes terechtkomt.
              </p>
            </Card>
          </>
        )
      )}
    </div>
  );
}
