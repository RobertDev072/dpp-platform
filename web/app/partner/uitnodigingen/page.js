"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { fullName } from "@/lib/labels";

// Uitnodigingsstatussen van de backend (pending/accepted/revoked) in het
// Nederlands; een verlopen openstaande uitnodiging tonen we als "Verlopen".
const INVITE_STATUS = {
  pending: { label: "Openstaand", variant: "warning" },
  accepted: { label: "Geaccepteerd", variant: "success" },
  revoked: { label: "Ingetrokken", variant: "neutral" }
};

function isExpired(invite) {
  return (
    invite.status === "pending" &&
    invite.expires_at &&
    new Date(invite.expires_at).getTime() < Date.now()
  );
}

function InviteStatusBadge({ invite }) {
  if (isExpired(invite)) {
    return <Badge variant="danger">Verlopen</Badge>;
  }
  const entry = INVITE_STATUS[invite.status];
  return <Badge variant={entry?.variant || "neutral"}>{entry?.label || invite.status}</Badge>;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("nl-NL") : "—";
}

// Partnerbreed overzicht van alle Bedrijfsbeheerder-uitnodigingen van de eigen
// klantbedrijven. Nieuwe uitnodigingen maak je aan via de klantdetailpagina.
export default function UitnodigingenPage() {
  const toast = useToast();

  const [invites, setInvites] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/partner/invites")
      .then((data) => {
        if (!cancelled) {
          setInvites(data);
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

  const loading = !invites && !error;

  async function handleRevoke(invite) {
    const sure = window.confirm(
      `Weet je zeker dat je de uitnodiging voor ${invite.email} wilt intrekken? De activatielink werkt daarna niet meer.`
    );
    if (!sure) return;

    const previous = invites;
    setInvites((prev) => prev.map((i) => (i.id === invite.id ? { ...i, status: "revoked" } : i)));
    try {
      await api.post(`/api/partner/customers/${invite.company_id}/invites/${invite.id}/revoke`);
      toast.success("Uitnodiging ingetrokken");
    } catch (err) {
      setInvites(previous);
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Uitnodigingen</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alle Bedrijfsbeheerder-uitnodigingen van je klantbedrijven. Nieuwe uitnodigingen maak
          je aan via de detailpagina van een klant.
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
        ) : (invites || []).length === 0 ? (
          <EmptyState
            title="Nog geen uitnodigingen"
            description="Nodig de eerste Bedrijfsbeheerder uit via de detailpagina van een klantbedrijf."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Klant</th>
                  <th className="py-2 pr-3 font-medium">Genodigde</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Aangemaakt</th>
                  <th className="py-2 pr-3 font-medium">Verloopt op</th>
                  <th className="py-2 pr-3 font-medium">Geaccepteerd op</th>
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/partner/klanten/${invite.company_id}`}
                        className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        {invite.company_name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <p className="text-slate-900">{fullName(invite) || invite.email}</p>
                      {fullName(invite) && (
                        <p className="text-xs text-slate-500">{invite.email}</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <InviteStatusBadge invite={invite} />
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">
                      {formatDateTime(invite.created_at)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">
                      {formatDateTime(invite.expires_at)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">
                      {formatDateTime(invite.accepted_at)}
                    </td>
                    <td className="py-2.5 pr-3">
                      {invite.status === "pending" && (
                        <Button
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => handleRevoke(invite)}
                        >
                          Intrekken
                        </Button>
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
