"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";
import ActivationUrlBox from "@/components/partner/ActivationUrlBox";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(value) {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const required = (label) => (value) => ((value || "").trim() ? null : `Vul ${label} in`);

// Platform Owner: nieuwe partner + eerste Partner Admin in één stap. De Partner Admin
// krijgt een activatielink (48 uur geldig, eenmalig) en kiest zelf een wachtwoord.
export default function NieuwePartnerPage() {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [created, setCreated] = useState(null);

  const form = useForm({
    initial: { name: "", slug: "", adminFirstName: "", adminLastName: "", adminEmail: "" },
    validators: {
      name: required("een naam"),
      slug: (value) => {
        const trimmed = (value || "").trim();
        if (!trimmed) return "Vul een slug in";
        return SLUG_PATTERN.test(trimmed) ? null : "Alleen kleine letters, cijfers en koppeltekens";
      },
      adminFirstName: required("een voornaam"),
      adminLastName: required("een achternaam"),
      adminEmail: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (creating || !form.validateAll()) return;
    setCreating(true);
    try {
      const result = await api.post("/api/admin/partners", {
        name: form.values.name.trim(),
        slug: form.values.slug.trim(),
        adminFirstName: form.values.adminFirstName.trim(),
        adminLastName: form.values.adminLastName.trim(),
        adminEmail: form.values.adminEmail.trim()
      });
      toast.success(`Partner ${result.name} aangemaakt`);
      setCreated(result);
    } catch (err) {
      if (!form.applyServerErrors(err)) setFormError(err);
    } finally {
      setCreating(false);
    }
  }

  const field = (name, props) => (
    <Field
      name={name}
      value={form.values[name]}
      onChange={(e) => form.setValue(name, e.target.value)}
      onBlur={() => form.onBlur(name)}
      error={form.errors[name]}
      {...props}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/partners" className="text-sm text-blue-600 hover:underline">
          ← Partners
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Nieuwe partner</h1>
      </div>

      {!created ? (
        <form onSubmit={handleSubmit} noValidate className="max-w-2xl space-y-6">
          <FormError error={formError} />
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-slate-900">1. Partner</h2>
            <div className="space-y-4">
              <Field
                label="Naam"
                name="name"
                required
                autoComplete="organization"
                value={form.values.name}
                onChange={(e) => form.setValue("name", e.target.value)}
                onBlur={() => {
                  if (!form.values.slug.trim() && form.values.name.trim()) form.setValue("slug", slugify(form.values.name));
                  form.onBlur("name");
                }}
                error={form.errors.name}
              />
              {field("slug", { label: "Slug", required: true, autoComplete: "off", help: "Kleine letters, cijfers en koppeltekens." })}
            </div>
          </Card>
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-slate-900">2. Eerste Partner Admin</h2>
            <p className="mb-4 text-xs text-slate-500">
              Krijgt een activatielink (48 uur geldig) en kan daarna klantbedrijven en hun eerste beheerder aanmaken.
            </p>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {field("adminFirstName", { label: "Voornaam", required: true, autoComplete: "off" })}
                {field("adminLastName", { label: "Achternaam", required: true, autoComplete: "off" })}
              </div>
              {field("adminEmail", { label: "E-mailadres", type: "email", required: true, autoComplete: "off" })}
            </div>
          </Card>
          <SubmitButton loading={creating}>Partner en Partner Admin aanmaken</SubmitButton>
        </form>
      ) : (
        <Card className="max-w-2xl">
          <div className="space-y-4">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Partner <span className="font-medium">{created.name}</span> is aangemaakt, met {created.invite.email} als Partner Admin.
            </p>
            <ActivationUrlBox activationUrl={created.invite.activationUrl} email={created.invite.email} roleLabel="de Partner Admin" />
            <Link href="/admin/partners" className="text-sm font-medium text-blue-600 hover:underline">
              Naar Partners
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
