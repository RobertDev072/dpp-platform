"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";

function ActivateForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Geen activatietoken gevonden. Vraag een nieuwe uitnodigingslink aan.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    api
      .get(`/api/invites/${token}`)
      .then((data) => {
        if (!cancelled) {
          setInvite(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Deze uitnodiging is niet (meer) geldig.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    const body = invite && invite.requiresPassword ? { password } : {};

    try {
      await api.post(`/api/invites/${token}/accept`, body);
      window.location.href = "/login";
    } catch (err) {
      setSubmitError(err);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="flex justify-center">
          <Logo />
        </div>

        <div className="mt-6 text-sm text-slate-600">
          {loading && "Uitnodiging laden..."}
          {!loading && loadError && <p className="text-red-600">{loadError}</p>}
          {!loading && invite && (
            <p>
              Welkom bij {invite.companyName || "DPP Platform"}. Activeer je account voor{" "}
              {invite.email}.
            </p>
          )}
        </div>

        {!loading && invite && (
          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            {invite.requiresPassword && (
              <Field
                label="Kies een wachtwoord"
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                placeholder="Minimaal 12 tekens"
                help="Gebruik minimaal 12 tekens, en combineer bij voorkeur hoofdletters, kleine letters, cijfers en een symbool."
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}

            <FormError error={submitError} />

            <SubmitButton loading={submitting} className="w-full">
              Account activeren
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ActivatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-slate-500">
          Laden...
        </div>
      }
    >
      <ActivateForm />
    </Suspense>
  );
}
