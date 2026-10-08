"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import IconButton, { KeyIcon } from "@/components/ui/IconButton";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import SubscriptionUsage from "@/components/license/SubscriptionUsage";
import ActivationUrlBox from "@/components/partner/ActivationUrlBox";
import CustomerInviteForm from "@/components/partner/CustomerInviteForm";
import TempPasswordBox from "@/components/partner/TempPasswordBox";
import { statusLabel, fullName, USER_STATUS_BADGE_VARIANTS } from "@/lib/labels";

// Uitnodigingsstatussen van de backend (pending/accepted/revoked) in het Nederlands.
const INVITE_STATUS = {
  pending: { label: "Openstaand", variant: "warning" },
  accepted: { label: "Geaccepteerd", variant: "success" },
  revoked: { label: "Ingetrokken", variant: "neutral" }
};

function InviteStatusBadge({ status }) {
  const entry = INVITE_STATUS[status];
  return <Badge variant={entry?.variant || "neutral"}>{entry?.label || status}</Badge>;
}

export default function KlantDetailPage() {
  const params = useParams();
  const customerId = params.id;
  const toast = useToast();

  const [license, setLicense] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // De activatielink van de laatst aangemaakte uitnodiging: eenmalig zichtbaar.
  const [createdInvite, setCreatedInvite] = useState(null);

  // Het tijdelijke wachtwoord van de laatste reset: eenmalig zichtbaar.
  const [resetInfo, setResetInfo] = useState(null);
  const [resettingId, setResettingId] = useState(null);

  useEffect(() => {
    if (!customerId) {
      return;
    }
    Promise.all([
      api.get(`/api/partner/customers/${customerId}/license`),
      api.get(`/api/partner/customers/${customerId}/admins`),
      api.get(`/api/partner/customers/${customerId}/invites`)
    ])
      .then(([licenseData, adminData, inviteData]) => {
        setLicense(licenseData);
        setAdmins(adminData);
        setInvites(inviteData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [customerId]);

  function handleInviteCreated(invite) {
    setCreatedInvite(invite);
    setInvites((prev) => [
      { id: invite.id, email: invite.email, status: invite.status, expires_at: invite.expires_at },
      ...prev
    ]);
  }

  async function handleResetPassword(admin) {
    const sure = window.confirm(
      `Weet je zeker dat je het wachtwoord van ${admin.email} wilt resetten? De huidige ` +
        "sessies worden beëindigd en er wordt een tijdelijk wachtwoord aangemaakt."
    );
    if (!sure) return;

    // Een eerder getoond tijdelijk wachtwoord sluiten zodra een nieuwe reset start.
    setResetInfo(null);
    setResettingId(admin.id);
    try {
      const result = await api.post(
        `/api/partner/customers/${customerId}/admins/${admin.id}/reset-password`
      );
      if (result?.tempPassword) {
        setResetInfo({ email: admin.email, tempPassword: result.tempPassword });
      } else {
        toast.error("Onverwacht antwoord van de server bij het resetten van het wachtwoord");
      }
    } catch (err) {
      // O.a. 409 (account niet actief) en 429 (te veel resets): de server legt het uit.
      toast.error(err.message);
    } finally {
      setResettingId(null);
    }
  }

  async function handleRevoke(invite) {
    const sure = window.confirm(
      `Weet je zeker dat je de uitnodiging voor ${invite.email} wilt intrekken? De activatielink werkt daarna niet meer.`
    );
    if (!sure) return;

    const previous = invites;
    setInvites((prev) => prev.map((i) => (i.id === invite.id ? { ...i, status: "revoked" } : i)));
    try {
      await api.post(`/api/partner/customers/${customerId}/invites/${invite.id}/revoke`);
      toast.success("Uitnodiging ingetrokken");
    } catch (err) {
      setInvites(previous);
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/partner/klanten" className="text-sm text-blue-600 hover:underline">
          ← Mijn klanten
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">
          Klantbedrijf{license ? ` — ${license.name}` : ""}
        </h1>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {loading ? (
        <Card>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </Card>
      ) : (
        !loadError &&
        license && (
          <>
            <Card>
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Licentie</h2>
              <SubscriptionUsage usage={license} />
            </Card>

            <Card>
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Bedrijfsbeheerders</h2>
              {admins.length === 0 ? (
                <EmptyState
                  title="Nog geen Bedrijfsbeheerders"
                  description="Zodra een uitnodiging geaccepteerd is, verschijnt de Bedrijfsbeheerder hier."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">Naam</th>
                        <th className="py-2 pr-3 font-medium">E-mail</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Acties</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admins.map((admin) => {
                        const isActive = admin.status === "active";
                        return (
                          <tr key={admin.id} className="border-b border-slate-100">
                            <td className="py-2.5 pr-3 font-medium text-slate-900">
                              {fullName(admin) || admin.email}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-600">{admin.email}</td>
                            <td className="py-2.5 pr-3">
                              <Badge variant={USER_STATUS_BADGE_VARIANTS[admin.status] || "neutral"}>
                                {statusLabel(admin.status)}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-3">
                              <IconButton
                                title={
                                  isActive
                                    ? "Wachtwoord resetten"
                                    : "Dit account is niet actief; herstel het account eerst, een wachtwoordreset heractiveert het niet"
                                }
                                disabled={!isActive || resettingId === admin.id}
                                onClick={() => handleResetPassword(admin)}
                              >
                                <KeyIcon />
                              </IconButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {resetInfo && (
                <div className="mt-4">
                  <TempPasswordBox
                    tempPassword={resetInfo.tempPassword}
                    email={resetInfo.email}
                    onClose={() => setResetInfo(null)}
                  />
                </div>
              )}
            </Card>

            <Card className="max-w-xl">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuwe uitnodiging</h2>
              <CustomerInviteForm customerId={customerId} onCreated={handleInviteCreated} />

              {createdInvite && (
                <div className="mt-4">
                  <ActivationUrlBox
                    activationUrl={createdInvite.activationUrl}
                    email={createdInvite.email}
                  />
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Uitnodigingen</h2>
              {invites.length === 0 ? (
                <EmptyState
                  title="Nog geen uitnodigingen"
                  description="Maak hierboven de eerste uitnodiging aan voor de Bedrijfsbeheerder van dit klantbedrijf."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">E-mail</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Verloopt op</th>
                        <th className="py-2 pr-3 font-medium">Acties</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => (
                        <tr key={invite.id} className="border-b border-slate-100">
                          <td className="py-2.5 pr-3">{invite.email}</td>
                          <td className="py-2.5 pr-3">
                            <InviteStatusBadge status={invite.status} />
                          </td>
                          <td className="whitespace-nowrap py-2.5 pr-3 text-slate-600">
                            {invite.expires_at
                              ? new Date(invite.expires_at).toLocaleString("nl-NL")
                              : "—"}
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
          </>
        )
      )}
    </div>
  );
}
