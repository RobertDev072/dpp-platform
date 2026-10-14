"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { ASSIGNABLE_ROLE_OPTIONS, PARTNER_ROLE_OPTIONS } from "@/lib/labels";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Gebruiker toevoegen aan één vast bedrijf (gekozen in het detailpaneel). Rolopties
// horen bij de bedrijfssoort: in een partnerbedrijf bestaat alleen Partner Admin,
// company-rollen alleen in klantbedrijven (de backend dwingt dit ook af).
export default function NewUserForm({ company, onCreated }) {
  const toast = useToast();
  const isPartner = company.kind === "partner";
  const roleOptions = isPartner ? PARTNER_ROLE_OPTIONS : ASSIGNABLE_ROLE_OPTIONS;
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null);

  const form = useForm({
    initial: { role: isPartner ? "partner_admin" : "", email: "", firstName: "", lastName: "" },
    validators: {
      role: (value) => (value ? null : "Kies een rol"),
      email: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setCreatedInfo(null);
    if (!form.validateAll()) return;

    setCreating(true);
    try {
      const created = await api.post("/api/users", {
        email: form.values.email.trim(),
        firstName: form.values.firstName.trim() || undefined,
        lastName: form.values.lastName.trim() || undefined,
        role: form.values.role,
        companyId: company.id
      });
      setCreatedInfo({ email: created.email, tempPassword: created.tempPassword || null });
      form.reset();
      toast.success(`Gebruiker ${created.email} aangemaakt`);
      onCreated?.();
    } catch (err) {
      if (!form.applyServerErrors(err)) {
        if (err.status === 409 && !err.code) {
          form.applyServerErrors({ fieldErrors: { email: [err.message] } });
        } else {
          setFormError(err);
        }
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormError error={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Rol"
            name="new-user-role"
            required
            placeholder={isPartner ? undefined : "Kies een rol"}
            options={roleOptions}
            help={isPartner ? "In een partnerbedrijf is alleen de rol Partner Admin mogelijk." : undefined}
            value={form.values.role}
            onChange={(e) => form.setValue("role", e.target.value)}
            onBlur={() => form.onBlur("role")}
            error={form.errors.role}
          />
          <Field
            label="E-mail"
            name="new-user-email"
            type="email"
            required
            autoComplete="off"
            placeholder="naam@bedrijf.nl"
            value={form.values.email}
            onChange={(e) => form.setValue("email", e.target.value)}
            onBlur={() => form.onBlur("email")}
            error={form.errors.email}
          />
          <Field
            label="Voornaam"
            name="new-user-firstName"
            autoComplete="off"
            value={form.values.firstName}
            onChange={(e) => form.setValue("firstName", e.target.value)}
            error={form.errors.firstName}
          />
          <Field
            label="Achternaam"
            name="new-user-lastName"
            autoComplete="off"
            value={form.values.lastName}
            onChange={(e) => form.setValue("lastName", e.target.value)}
            error={form.errors.lastName}
          />
        </div>
        <p className="text-xs text-slate-400">
          De nieuwe gebruiker stelt het eigen wachtwoord in via Wachtwoord vergeten op de loginpagina.
        </p>
        <SubmitButton loading={creating}>Aanmaken</SubmitButton>
      </form>

      {createdInfo && !createdInfo.tempPassword && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          Laat <span className="font-medium">{createdInfo.email}</span> het wachtwoord instellen via{" "}
          <span className="font-medium">Wachtwoord vergeten</span> op de loginpagina.
        </div>
      )}
      {createdInfo && createdInfo.tempPassword && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            Tijdelijk wachtwoord voor {createdInfo.email} (wordt maar één keer getoond en is 24 uur geldig; deel het
            zelf veilig met de gebruiker):
          </p>
          <input
            readOnly
            aria-label="Tijdelijk wachtwoord"
            value={createdInfo.tempPassword}
            onClick={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900"
          />
        </div>
      )}
    </div>
  );
}
