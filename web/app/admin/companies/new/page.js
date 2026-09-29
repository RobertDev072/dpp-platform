"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";

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

export default function NewCompanyPage() {
  const router = useRouter();
  const toast = useToast();

  const [plans, setPlans] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);

  const form = useForm({
    initial: { name: "", slug: "", planId: "" },
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
      }
    }
  });

  useEffect(() => {
    api
      .get("/api/admin/plans")
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
      const created = await api.post("/api/admin/companies", {
        name: form.values.name.trim(),
        slug: form.values.slug.trim(),
        planId: form.values.planId ? Number(form.values.planId) : undefined
      });
      toast.success(`Bedrijf ${created.name} aangemaakt`);
      router.push("/admin/companies");
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
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/companies" className="text-sm text-blue-600 hover:underline">
          ← Bedrijven
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Nieuw bedrijf</h1>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <Card className="max-w-xl">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FormError error={formError} />

          <Field
            label="Naam"
            name="name"
            required
            autoComplete="off"
            placeholder="Bijv. Aareon Nederland"
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
            placeholder="bijv-aareon-nederland"
            help="Alleen kleine letters, cijfers en koppeltekens. Wordt automatisch voorgesteld op basis van de naam."
            value={form.values.slug}
            onChange={(e) => form.setValue("slug", e.target.value)}
            onBlur={() => form.onBlur("slug")}
            error={form.errors.slug}
          />

          <Select
            label="Plan"
            name="planId"
            placeholder="— geen plan —"
            options={plans.map((plan) => ({ value: String(plan.id), label: plan.name }))}
            value={form.values.planId}
            onChange={(e) => form.setValue("planId", e.target.value)}
            error={form.errors.planId}
          />

          <SubmitButton loading={creating}>Aanmaken</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
