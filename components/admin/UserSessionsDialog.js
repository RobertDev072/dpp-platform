"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ActionButton from "@/components/ui/ActionButton";
import { useToast } from "@/components/ui/Toast";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

// Grove, leesbare browserbeschrijving uit de user-agent (geen fingerprinting).
export function describeUserAgent(ua) {
  if (!ua) return "Onbekende browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} op ${os}` : browser;
}

// Toont actieve sessies van een gebruiker en laat de beheerder ze allemaal beëindigen.
export default function UserSessionsDialog({ user, onClose, onRevoked, canRevoke = true }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    api
      .get(`/api/users/${user.id}/sessions`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user.id]);

  async function revoke() {
    setRevoking(true);
    try {
      const result = await api.post(`/api/users/${user.id}/sessions/revoke`);
      toast.success(`${result.revoked} sessie${result.revoked === 1 ? "" : "s"} beëindigd`);
      onRevoked?.();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="sessions-title">
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <div>
          <h2 id="sessions-title" className="text-base font-semibold text-slate-900">
            Sessies van {user.email}
          </h2>
          <p className="text-sm text-slate-500">Laatste login: {formatDateTime(data?.lastLoginAt)}</p>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!data && !error ? (
          <p className="text-sm text-slate-500">Laden…</p>
        ) : data && data.items.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">Geen actieve sessies.</p>
        ) : data ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.items.map((s) => (
              <li key={s.id} className="px-3 py-2 text-sm">
                <span className="block font-medium text-slate-900">
                  {describeUserAgent(s.user_agent)}
                  {s.is_impersonation && <span className="ml-2 text-xs font-normal text-amber-700">(support-impersonatie)</span>}
                </span>
                <span className="block text-xs text-slate-500">
                  Gestart {formatDateTime(s.created_at)} · verloopt {formatDateTime(s.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <ActionButton onClick={onClose}>Sluiten</ActionButton>
          {canRevoke && data && data.items.length > 0 && (
            <ActionButton variant="danger" disabled={revoking} onClick={revoke}>
              {revoking ? "Bezig…" : "Alle sessies beëindigen"}
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}
