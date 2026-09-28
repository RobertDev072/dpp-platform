"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";

function ActivateForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState("");
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
    setSubmitError("");
    setSubmitting(true);

    const body = invite && invite.requiresPassword ? { password } : {};

    try {
      const result = await api.post(`/api/invites/${token}/accept`, body);
      if (result.mustSetPassword) {
        window.location.href = `/wachtwoord-vergeten?setup=1&email=${encodeURIComponent(result.email)}`;
      } else {
        window.location.href = "/login";
      }
    } catch (err) {
      setSubmitError(err.message);
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
              <label className="block text-sm font-medium text-slate-700">
                Kies een wachtwoord (min. 12 tekens)
                <input
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </label>
            )}

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              Account activeren
            </button>
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
