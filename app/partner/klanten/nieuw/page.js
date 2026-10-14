"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
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

// Plannaam mét limieten, zodat de partner direct ziet wat de klant krijgt.
function planOptionLabel(plan) {
  return `${plan.name} (max. ${plan.max_users} gebruikers, ${plan.max_products} producten)`;
}

const required = (label) => (value) => ((value || "").trim() ? null : `Vul ${label} in`);

// Nieuw klantbedrijf + eerste Bedrijfsbeheerder in één formulier en één stap. De server
// maakt beide in één transactie aan (alles of niets) en geeft een activatielink terug
// (48 uur geldig, eenmalig); de beheerder kiest daarmee zelf een wachtwoord.
export default function NieuwKlantbedrijfPage() {
  const toast = useToast();

  const [plans, setPlans] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [created, setCreated] = useState(null);

  const form = useForm({
    initial: {
      name: "",
      slug: "",
      planId: "",
      licenseStart: "",
      licenseEnd: "",
      adminFirstName: "",
      adminLastName: "",
      adminEmail: ""
    },
    validators: {
      name: required("een bedrijfsnaam"),
      slug: (value) => {
        const trimmed = (value || "").trim();
        if (!trimmed) return "Vul een slug in";
        return SLUG_PATTERN.test(trimmed) ? null : "Alleen kleine letters, cijfers en koppeltekens";
      },
      planId: (value) => (value ? null : "Kies een plan"),
      licenseEnd: (value, values) =>
        value && values.licenseStart && value < values.licenseStart ? "Einddatum ligt vóór de startdatum" : null,
      adminFirstName: required("een voornaam"),
      adminLastName: required("een achternaam"),
      adminEmail: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  useEffect(() => {
    api
      .get("/api/partner/plans")
      .then((data) => setPlans(data))
      .catch((err) => setLoadError(err.message));
  }, []);

  function handleNameBlur() {
    // Slug voorstellen op basis van de naam, maar alleen zolang die nog leeg is.
    if (!form.values.slug.trim() && form.values.name.trim()) {
      form.setValue("slug", slugify(form.values.name));
    }
    form.onBlur("name");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (creating || !form.validateAll()) return;

    setCreating(true);
    try {
      const result = await api.post("/api/partner/customers", {
        name: form.values.name.trim(),
        slug: form.values.slug.trim(),
        planId: Number(form.values.planId),
        licenseStart: form.values.licenseStart || null,
        licenseEnd: form.values.licenseEnd || null,
        adminFirstName: form.values.adminFirstName.trim(),
        adminLastName: form.values.adminLastName.trim(),
        adminEmail: form.values.adminEmail.trim()
      });
      toast.success(`Klantbedrijf ${result.name} en beheerder aangemaakt`);
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
        <Link href="/partner/klanten" className="text-sm text-blue-600 hover:underline">
          ← Mijn klanten
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Nieuw klantbedrijf</h1>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {!created ? (
        <form onSubmit={handleSubmit} noValidate className="max-w-2xl space-y-6">
          <FormError error={formError} />

          <Card>
            <h2 className="mb-4 text-sm font-semibold text-slate-900">1. Bedrijfsgegevens</h2>
            <div className="space-y-4">
              <Field
                label="Bedrijfsnaam"
                name="name"
                required
                autoComplete="organization"
                placeholder="Bijv. Bouwbedrijf Jansen"
                value={form.values.name}
                onChange={(e) => form.setValue("name", e.target.value)}
                onBlur={handleNameBlur}
                error={form.errors.name}
              />
              {field("slug", {
                label: "Slug",
                required: true,
                autoComplete: "off",
                placeholder: "bijv-bouwbedrijf-jansen",
                help: "Unieke korte naam: kleine letters, cijfers en koppeltekens. Wordt voorgesteld op basis van de naam."
              })}
              <Select
                label="Abonnement"
                name="planId"
                required
                placeholder="Kies een plan"
                options={plans.map((plan) => ({ value: String(plan.id), label: planOptionLabel(plan) }))}
                value={form.values.planId}
                onChange={(e) => form.setValue("planId", e.target.value)}
                onBlur={() => form.onBlur("planId")}
                error={form.errors.planId}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {field("licenseStart", { label: "Geldig van", type: "date", help: "Leeg = direct" })}
                {field("licenseEnd", { label: "Geldig tot", type: "date", help: "Leeg = geen einddatum" })}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 text-sm font-semibold text-slate-900">2. Eerste Bedrijfsbeheerder</h2>
            <p className="mb-4 text-xs text-slate-500">
              Krijgt een activatielink (48 uur geldig) en kiest daarmee zelf een wachtwoord. Daarna
              kan de beheerder zelf medewerkers toevoegen.
            </p>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {field("adminFirstName", { label: "Voornaam", required: true, autoComplete: "off" })}
                {field("adminLastName", { label: "Achternaam", required: true, autoComplete: "off" })}
              </div>
              {field("adminEmail", { label: "E-mailadres", type: "email", required: true, autoComplete: "off" })}
            </div>
          </Card>

          <SubmitButton loading={creating}>Bedrijf en beheerder aanmaken</SubmitButton>
        </form>
      ) : (
        <Card className="max-w-2xl">
          <div className="space-y-4">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Klantbedrijf <span className="font-medium">{created.name}</span> is aangemaakt, met{" "}
              {created.invite.email} als eerste Bedrijfsbeheerder.
            </p>
            <ActivationUrlBox activationUrl={created.invite.activationUrl} email={created.invite.email} roleLabel="de Bedrijfsbeheerder" />
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={`/partner/klanten/${created.id}`} className="font-medium text-blue-600 hover:underline">
                Naar klantdetail
              </Link>
              <Link href="/partner/klanten" className="text-blue-600 hover:underline">
                Naar Mijn klanten
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
