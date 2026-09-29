"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { roleLabel } from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

export default function ProfileForm() {
  const toast = useToast();

  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const form = useForm({ initial: { firstName: "", lastName: "" } });

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/auth/me")
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          form.setValue("firstName", data.firstName || "");
          form.setValue("lastName", data.lastName || "");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.message);
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
    // Alleen bij mount laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const updated = await api.patch("/api/auth/me", {
        firstName: form.values.firstName.trim(),
        lastName: form.values.lastName.trim()
      });
      if (updated) {
        setMe((prev) => ({ ...prev, ...updated }));
      }
      toast.success("Profiel opgeslagen");
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Profiel</h1>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (loadError || !me) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Profiel</h1>
        <Card className="border-red-200 bg-red-50 text-red-700">
          {loadError || "Kon het profiel niet laden."}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Profiel</h1>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Persoonlijke gegevens</h2>
          <Badge variant="success">{roleLabel(me.role)}</Badge>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FormError error={formError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Voornaam"
              name="firstName"
              autoComplete="given-name"
              placeholder="Bijv. Anna"
              value={form.values.firstName}
              onChange={(e) => form.setValue("firstName", e.target.value)}
              error={form.errors.firstName}
            />
            <Field
              label="Achternaam"
              name="lastName"
              autoComplete="family-name"
              placeholder="Bijv. de Vries"
              value={form.values.lastName}
              onChange={(e) => form.setValue("lastName", e.target.value)}
              error={form.errors.lastName}
            />
          </div>

          <div className="max-w-md">
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={me.email}
              readOnly
              disabled
              className="mt-1 block w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
            <p className="mt-1 text-xs text-slate-400">Je e-mailadres kan niet gewijzigd worden.</p>
          </div>

          <SubmitButton loading={saving}>Opslaan</SubmitButton>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Wachtwoord</h2>
        {me.authProvider === "entra" ? (
          <p className="text-sm text-slate-600">
            Je wachtwoord wordt beheerd via Microsoft Entra. Wijzig het via{" "}
            <Link href="/wachtwoord-vergeten" className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline">
              Wachtwoord vergeten
            </Link>
            .
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Dit account gebruikt een lokaal wachtwoord; reset kan via een beheerder.
          </p>
        )}
      </Card>
    </div>
  );
}
