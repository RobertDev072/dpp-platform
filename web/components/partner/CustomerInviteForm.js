"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Uitnodigingsformulier voor de eerste (of een volgende) Company Admin van een
// klantbedrijf van deze partner. De aanroeper toont zelf de eenmalige
// activationUrl uit onCreated — die komt alleen in dít antwoord terug.
export default function CustomerInviteForm({ customerId, submitLabel = "Uitnodiging aanmaken", onCreated }) {
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [formError, setFormError] = useState(null);

  const form = useForm({
    initial: { email: "", firstName: "", lastName: "" },
    validators: {
      email: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.validateAll()) {
      return;
    }

    setInviting(true);
    try {
      const result = await api.post(`/api/partner/customers/${customerId}/invites`, {
        email: form.values.email.trim(),
        firstName: form.values.firstName.trim() || undefined,
        lastName: form.values.lastName.trim() || undefined
      });

      form.reset();
      toast.success(`Uitnodiging aangemaakt voor ${result.email}`);
      onCreated(result);
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

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormError error={formError} />

      <Field
        label="E-mail"
        name="invite-email"
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
          name="invite-firstName"
          autoComplete="off"
          placeholder="Bijv. Anna"
          value={form.values.firstName}
          onChange={(e) => form.setValue("firstName", e.target.value)}
          error={form.errors.firstName}
        />
        <Field
          label="Achternaam"
          name="invite-lastName"
          autoComplete="off"
          placeholder="Bijv. de Vries"
          value={form.values.lastName}
          onChange={(e) => form.setValue("lastName", e.target.value)}
          error={form.errors.lastName}
        />
      </div>

      <SubmitButton loading={inviting}>{submitLabel}</SubmitButton>
    </form>
  );
}
