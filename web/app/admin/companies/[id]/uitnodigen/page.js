"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteCompanyAdminPage() {
  const params = useParams();
  const companyId = params.id;
  const toast = useToast();

  const [company, setCompany] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [inviting, setInviting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [activationUrl, setActivationUrl] = useState("");

  const form = useForm({
    initial: { email: "", firstName: "", lastName: "" },
    validators: {
      email: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  useEffect(() => {
    if (!companyId) {
      return;
    }
    Promise.all([
      api.get(`/api/admin/companies/${companyId}`),
      api.get(`/api/admin/companies/${companyId}/invites`)
    ])
      .then(([companyData, inviteData]) => {
        setCompany(companyData);
        setInvites(inviteData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  async function handleInvite(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.validateAll()) {
      return;
    }

    setInviting(true);
    try {
      const result = await api.post(`/api/admin/companies/${companyId}/invites`, {
        email: form.values.email.trim(),
        firstName: form.values.firstName.trim() || undefined,
        lastName: form.values.lastName.trim() || undefined
      });

      // Het token zit alleen in dít antwoord: de activatielink is eenmalig zichtbaar.
      setActivationUrl(result.activationUrl);
      setInvites((prev) => [
        { id: result.id, email: result.email, status: result.status, expires_at: result.expires_at },
        ...prev
      ]);
      form.reset();
      toast.success(`Uitnodiging aangemaakt voor ${result.email}`);
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        if (err.status === 409 && !err.code) {
          // "Er is al een openstaande uitnodiging voor dit e-mailadres": onder het e-mailveld tonen.
          form.applyServerErrors({ fieldErrors: { email: [err.message] } });
        } else {
          setFormError(err);
        }
      }
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(inviteId) {
    const previous = invites;
    setInvites((prev) => prev.map((i) => (i.id === inviteId ? { ...i, status: "revoked" } : i)));
    try {
      await api.post(`/api/admin/companies/${companyId}/invites/${inviteId}/revoke`);
      toast.success("Uitnodiging ingetrokken");
    } catch (err) {
      setInvites(previous);
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/companies" className="text-sm text-blue-600 hover:underline">
          ← Bedrijven
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">
          Company Admin uitnodigen{company ? ` — ${company.name}` : ""}
        </h1>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {loading ? (
        <Card>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </Card>
      ) : (
        !loadError && (
          <>
            <Card className="max-w-xl">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuwe uitnodiging</h2>
              <form onSubmit={handleInvite} noValidate className="space-y-4">
                <FormError error={formError} />

                <Field
                  label="E-mail"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="naam@bedrijf.nl"
                  value={form.values.email}
                  onChange={(e) => form.setValue("email", e.target.value)}
                  onBlur={() => form.onBlur("email")}
                  error={form.errors.email}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Voornaam"
                    name="firstName"
                    autoComplete="off"
                    placeholder="Bijv. Anna"
                    value={form.values.firstName}
                    onChange={(e) => form.setValue("firstName", e.target.value)}
                    error={form.errors.firstName}
                  />
                  <Field
                    label="Achternaam"
                    name="lastName"
                    autoComplete="off"
                    placeholder="Bijv. de Vries"
                    value={form.values.lastName}
                    onChange={(e) => form.setValue("lastName", e.target.value)}
                    error={form.errors.lastName}
                  />
                </div>

                <SubmitButton loading={inviting}>Uitnodiging aanmaken</SubmitButton>
              </form>

              {activationUrl && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-2 text-sm font-medium text-amber-800">
                    Activatielink (wordt maar één keer getoond, deel deze zelf met de Company Admin):
                  </p>
                  <input
                    readOnly
                    value={activationUrl}
                    onClick={(e) => e.target.select()}
                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
                  />
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Uitnodigingen</h2>
              {invites.length === 0 ? (
                <EmptyState
                  title="Nog geen uitnodigingen"
                  description="Maak hierboven de eerste uitnodiging aan voor dit bedrijf."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3">E-mail</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Verloopt</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => (
                        <tr key={invite.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3">{invite.email}</td>
                          <td className="py-2 pr-3">{invite.status}</td>
                          <td className="py-2 pr-3">{new Date(invite.expires_at).toLocaleString("nl-NL")}</td>
                          <td className="py-2 pr-3">
                            {invite.status === "pending" && (
                              <Button variant="outline" onClick={() => handleRevoke(invite.id)}>
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
