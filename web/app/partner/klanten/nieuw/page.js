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
import CustomerInviteForm from "@/components/partner/CustomerInviteForm";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

export default function NieuwKlantbedrijfPage() {
  const toast = useToast();

  const [plans, setPlans] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);

  // Stap 2 (uitnodigen) verschijnt pas nadat het klantbedrijf is aangemaakt;
  // de activatielink is eenmalig en blijft daarna op deze pagina staan.
  const [createdCompany, setCreatedCompany] = useState(null);
  const [createdInvite, setCreatedInvite] = useState(null);

  const form = useForm({
    initial: { name: "", slug: "", planId: "", licenseStart: "", licenseEnd: "" },
    validators: {
      name: (value) => ((value || "").trim() ? null : "Vul een bedrijfsnaam in"),
      slug: (value) => {
        const trimmed = (value || "").trim();
        if (!trimmed) {
          return "Vul een slug in";
        }
        if (!SLUG_PATTERN.test(trimmed)) {
          return "Alleen kleine letters, cijfers en koppeltekens";
        }
        return null;
      },
      planId: (value) => (value ? null : "Kies een plan"),
      licenseEnd: (value, values) =>
        value && values.licenseStart && value < values.licenseStart
          ? "Einddatum ligt vóór de startdatum"
          : null
    }
  });

  useEffect(() => {
    api
      .get("/api/partner/plans")
      .then((data) => setPlans(data))
      .catch((err) => setLoadError(err.message));
  }, []);

  function handleNameBlur() {
    // Slug voorstellen op basis van de naam, maar alleen zolang die nog leeg is —
    // een handmatig ingevulde slug wordt nooit overschreven.
    if (!form.values.slug.trim() && form.values.name.trim()) {
      form.setValue("slug", slugify(form.values.name));
    }
    form.onBlur("name");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.validateAll()) {
      return;
    }

    setCreating(true);
    try {
      const created = await api.post("/api/partner/customers", {
        name: form.values.name.trim(),
        slug: form.values.slug.trim(),
        planId: Number(form.values.planId),
        licenseStart: form.values.licenseStart || null,
        licenseEnd: form.values.licenseEnd || null
      });
      toast.success(`Klantbedrijf ${created.name} aangemaakt`);
      setCreatedCompany(created);
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        if (err.status === 409 && !err.code) {
          // "Slug is al in gebruik" komt als kale 409-message terug: onder het slugveld tonen.
          form.applyServerErrors({ fieldErrors: { slug: [err.message] } });
        } else {
          setFormError(err);
        }
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/partner/klanten" className="text-sm text-blue-600 hover:underline">
          ← Mijn klanten
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Nieuw klantbedrijf</h1>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {!createdCompany ? (
        <Card className="max-w-xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <FormError error={formError} />

            <Field
              label="Naam"
              name="name"
              required
              autoComplete="off"
              placeholder="Bijv. Bouwbedrijf Jansen"
              value={form.values.name}
              onChange={(e) => form.setValue("name", e.target.value)}
              onBlur={handleNameBlur}
              error={form.errors.name}
            />

            <Field
              label="Slug"
              name="slug"
              required
              autoComplete="off"
              placeholder="bijv-bouwbedrijf-jansen"
              help="Alleen kleine letters, cijfers en koppeltekens. Wordt automatisch voorgesteld op basis van de naam."
              value={form.values.slug}
              onChange={(e) => form.setValue("slug", e.target.value)}
              onBlur={() => form.onBlur("slug")}
              error={form.errors.slug}
            />

            <Select
              label="Plan"
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
              <Field
                label="Licentie geldig van"
                name="licenseStart"
                type="date"
                help="Leeg = geen startdatum"
                value={form.values.licenseStart}
                onChange={(e) => form.setValue("licenseStart", e.target.value)}
                error={form.errors.licenseStart}
              />
              <Field
                label="Licentie geldig tot"
                name="licenseEnd"
                type="date"
                help="Leeg = geen einddatum"
                value={form.values.licenseEnd}
                onChange={(e) => form.setValue("licenseEnd", e.target.value)}
                onBlur={() => form.onBlur("licenseEnd")}
                error={form.errors.licenseEnd}
              />
            </div>

            <SubmitButton loading={creating}>Klantbedrijf aanmaken</SubmitButton>
          </form>
        </Card>
      ) : (
        <>
          <Card className="max-w-xl border-emerald-200 bg-emerald-50 text-emerald-800">
            <p className="text-sm">
              Klantbedrijf <span className="font-medium">{createdCompany.name}</span> is aangemaakt.
              Nodig hieronder direct de eerste Bedrijfsbeheerder uit, of doe dit later via de
              detailpagina.
            </p>
          </Card>

          {!createdInvite ? (
            <Card className="max-w-xl">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">
                Eerste Bedrijfsbeheerder uitnodigen
              </h2>
              <CustomerInviteForm
                customerId={createdCompany.id}
                onCreated={(invite) => setCreatedInvite(invite)}
              />
              <p className="mt-4 text-sm">
                <Link
                  href={`/partner/klanten/${createdCompany.id}`}
                  className="text-blue-600 hover:underline"
                >
                  Overslaan — later uitnodigen via de detailpagina
                </Link>
              </p>
            </Card>
          ) : (
            <Card className="max-w-xl">
              <div className="space-y-4">
                <ActivationUrlBox
                  activationUrl={createdInvite.activationUrl}
                  email={createdInvite.email}
                />
                <div className="flex flex-wrap gap-3 text-sm">
                  <Link
                    href={`/partner/klanten/${createdCompany.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    Naar klantdetail
                  </Link>
                  <Link href="/partner/klanten" className="text-blue-600 hover:underline">
                    Naar Mijn klanten
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
