"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";
import NumberField from "@/components/products/NumberField";
import { useToast } from "@/components/ui/Toast";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatPrice, formatValidity, toDateInputValue } from "@/components/license/licenseFormat";

// Validators voor plan-formulieren (nieuw plan en inline bewerken delen ze).
const planValidators = {
  name: (value) => (!value || !value.trim() ? "Naam is verplicht" : null),
  maxUsers: (value) => validatePositiveInt(value, "Max. gebruikers"),
  maxProducts: (value) => validatePositiveInt(value, "Max. producten")
};

// Optionele extra's: prijs (euro), opslag (GB) en scans per maand. Leeg = geen limiet/onbekend.
function optionalNumber(value, label, { integer = false } = {}) {
  if (value === "" || value == null) return null;
  const num = Number(String(value).replace(",", "."));
  if (!Number.isFinite(num) || num < 0 || (integer && !Number.isInteger(num))) {
    return `${label} moet een ${integer ? "geheel " : ""}getal van 0 of meer zijn`;
  }
  return null;
}
planValidators.priceEuro = (v) => optionalNumber(v, "Prijs");
planValidators.storageGb = (v) => optionalNumber(v, "Opslag");
planValidators.scansMonth = (v) => optionalNumber(v, "Scans per maand", { integer: true });

function extrasToApi(values) {
  const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  const price = num(values.priceEuro);
  const storage = num(values.storageGb);
  const scans = num(values.scansMonth);
  return {
    priceMonthlyCents: price == null ? null : Math.round(price * 100),
    maxStorageMb: storage == null || storage === 0 ? null : Math.max(1, Math.round(storage * 1024)),
    maxScansMonth: scans == null || scans === 0 ? null : scans
  };
}

function extrasFromPlan(plan) {
  return {
    priceEuro: plan.price_monthly_cents != null ? String(plan.price_monthly_cents / 100).replace(".", ",") : "",
    storageGb: plan.max_storage_mb != null ? String(Math.round((plan.max_storage_mb / 1024) * 10) / 10).replace(".", ",") : "",
    scansMonth: plan.max_scans_month != null ? String(plan.max_scans_month) : ""
  };
}

function PlanExtraFields({ form, prefix }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field
        label="Prijs per maand (€, optioneel)"
        name={`${prefix}-priceEuro`}
        inputMode="decimal"
        placeholder="Bijv. 149"
        value={form.values.priceEuro}
        error={form.errors.priceEuro}
        onChange={(e) => form.setValue("priceEuro", e.target.value)}
        onBlur={() => form.onBlur("priceEuro")}
      />
      <Field
        label="Opslag (GB, optioneel)"
        name={`${prefix}-storageGb`}
        inputMode="decimal"
        placeholder="Leeg = onbeperkt"
        value={form.values.storageGb}
        error={form.errors.storageGb}
        onChange={(e) => form.setValue("storageGb", e.target.value)}
        onBlur={() => form.onBlur("storageGb")}
      />
      <Field
        label="QR-scans per maand (optioneel)"
        name={`${prefix}-scansMonth`}
        inputMode="numeric"
        placeholder="Leeg = geen limiet"
        value={form.values.scansMonth}
        error={form.errors.scansMonth}
        onChange={(e) => form.setValue("scansMonth", e.target.value)}
        onBlur={() => form.onBlur("scansMonth")}
      />
    </div>
  );
}

function validatePositiveInt(value, label) {
  if (value === "" || value == null) {
    return `${label} is verplicht`;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    return `${label} moet een geheel getal groter dan 0 zijn`;
  }
  return null;
}

// Formulier voor een nieuw licentieplan.
function NewPlanForm({ onCreated }) {
  const toast = useToast();
  const form = useForm({
    initial: { name: "", maxUsers: "", maxProducts: "", priceEuro: "", storageGb: "", scansMonth: "" },
    validators: planValidators
  });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) {
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/admin/plans", {
        name: form.values.name.trim(),
        maxUsers: Number(form.values.maxUsers),
        maxProducts: Number(form.values.maxProducts),
        ...extrasToApi(form.values)
      });
      toast.success("Plan aangemaakt");
      form.reset();
      await onCreated();
    } catch (err) {
      if (!form.applyServerErrors(err)) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormError error={formError} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Naam"
          name="plan-name"
          value={form.values.name}
          error={form.errors.name}
          onChange={(e) => form.setValue("name", e.target.value)}
          onBlur={() => form.onBlur("name")}
        />
        <NumberField
          label="Max. gebruikers"
          name="plan-maxUsers"
          min="1"
          step="1"
          inputMode="numeric"
          value={form.values.maxUsers}
          error={form.errors.maxUsers}
          onChange={(e) => form.setValue("maxUsers", e.target.value)}
          onBlur={() => form.onBlur("maxUsers")}
        />
        <NumberField
          label="Max. producten"
          name="plan-maxProducts"
          min="1"
          step="1"
          inputMode="numeric"
          value={form.values.maxProducts}
          error={form.errors.maxProducts}
          onChange={(e) => form.setValue("maxProducts", e.target.value)}
          onBlur={() => form.onBlur("maxProducts")}
        />
      </div>
      <PlanExtraFields form={form} prefix="plan" />
      <SubmitButton loading={saving}>Plan aanmaken</SubmitButton>
    </form>
  );
}

// Inline bewerken van een bestaand plan (naam + limieten).
function PlanEditForm({ plan, onSaved, onCancel }) {
  const toast = useToast();
  const form = useForm({
    initial: {
      name: plan.name,
      maxUsers: String(plan.max_users),
      maxProducts: String(plan.max_products),
      ...extrasFromPlan(plan)
    },
    validators: planValidators
  });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) {
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/admin/plans/${plan.id}`, {
        name: form.values.name.trim(),
        maxUsers: Number(form.values.maxUsers),
        maxProducts: Number(form.values.maxProducts),
        ...extrasToApi(form.values)
      });
      toast.success("Plan bijgewerkt");
      await onSaved();
    } catch (err) {
      if (!form.applyServerErrors(err)) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormError error={formError} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Naam"
          name={`plan-${plan.id}-name`}
          value={form.values.name}
          error={form.errors.name}
          onChange={(e) => form.setValue("name", e.target.value)}
          onBlur={() => form.onBlur("name")}
        />
        <NumberField
          label="Max. gebruikers"
          name={`plan-${plan.id}-maxUsers`}
          min="1"
          step="1"
          inputMode="numeric"
          value={form.values.maxUsers}
          error={form.errors.maxUsers}
          onChange={(e) => form.setValue("maxUsers", e.target.value)}
          onBlur={() => form.onBlur("maxUsers")}
        />
        <NumberField
          label="Max. producten"
          name={`plan-${plan.id}-maxProducts`}
          min="1"
          step="1"
          inputMode="numeric"
          value={form.values.maxProducts}
          error={form.errors.maxProducts}
          onChange={(e) => form.setValue("maxProducts", e.target.value)}
          onBlur={() => form.onBlur("maxProducts")}
        />
      </div>
      <PlanExtraFields form={form} prefix={`plan-${plan.id}`} />
      <div className="flex gap-2">
        <SubmitButton loading={saving}>Opslaan</SubmitButton>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuleren
        </Button>
      </div>
    </form>
  );
}

// Bedrijven op een plan, elk met EIGEN verbruik en status.
function PlanCompanies({ planId }) {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/admin/plans/${planId}/companies`)
      .then((data) => {
        if (!cancelled) setCompanies(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  if (error) {
    return <FormError error={error} />;
  }

  if (companies === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-500">
        Verbruik geldt per bedrijf; limieten worden nooit gedeeld.
      </p>
      {companies.length === 0 ? (
        <EmptyState title="Geen klantbedrijven op dit plan" />
      ) : (
        <ul className="space-y-2">
          {companies.map((company) => (
            <li
              key={company.companyId}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{company.name}</span>
                <LicenseStatusBadge status={company.status} />
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <UsageBar label="Gebruikers" {...company.users} />
                <UsageBar label="Producten" {...company.products} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Inline bewerken van plan + geldigheid van één bedrijf.
function CompanyLicenseEditForm({ company, plans, onSaved, onCancel }) {
  const toast = useToast();
  const form = useForm({
    initial: {
      planId: company.planId ? String(company.planId) : "",
      licenseStart: toDateInputValue(company.licenseStart),
      licenseEnd: toDateInputValue(company.licenseEnd)
    },
    validators: {
      licenseEnd: (value, values) =>
        value && values.licenseStart && value < values.licenseStart
          ? "Einddatum ligt vóór de startdatum"
          : null
    }
  });
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) {
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/admin/companies/${company.companyId}`, {
        planId: form.values.planId ? Number(form.values.planId) : null,
        licenseStart: form.values.licenseStart || null,
        licenseEnd: form.values.licenseEnd || null
      });
      toast.success("Abonnement bijgewerkt");
      await onSaved();
    } catch (err) {
      if (!form.applyServerErrors(err)) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormError error={formError} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Plan"
          name={`company-${company.companyId}-planId`}
          placeholder="Geen plan"
          options={plans.map((plan) => ({ value: String(plan.id), label: plan.name }))}
          value={form.values.planId}
          error={form.errors.planId}
          onChange={(e) => form.setValue("planId", e.target.value)}
        />
        <Field
          label="Startdatum"
          name={`company-${company.companyId}-licenseStart`}
          type="date"
          help="Leeg = geen startdatum"
          value={form.values.licenseStart}
          error={form.errors.licenseStart}
          onChange={(e) => form.setValue("licenseStart", e.target.value)}
        />
        <Field
          label="Einddatum"
          name={`company-${company.companyId}-licenseEnd`}
          type="date"
          help="Leeg = geen einddatum"
          value={form.values.licenseEnd}
          error={form.errors.licenseEnd}
          onChange={(e) => form.setValue("licenseEnd", e.target.value)}
          onBlur={() => form.onBlur("licenseEnd")}
        />
      </div>
      <div className="flex gap-2">
        <SubmitButton loading={saving}>Opslaan</SubmitButton>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuleren
        </Button>
      </div>
    </form>
  );
}

export default function LicensesPage() {
  const [plans, setPlans] = useState(null);
  const [overview, setOverview] = useState(null);
  const [pageError, setPageError] = useState("");

  // Uitgeklapte rijen (één tegelijk per soort).
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [companiesPlanId, setCompaniesPlanId] = useState(null);
  const [editingCompanyId, setEditingCompanyId] = useState(null);
  const [planFilter, setPlanFilter] = useState("");

  const loadPlans = useCallback(async () => {
    setPlans(await api.get("/api/admin/plans"));
  }, []);

  const loadOverview = useCallback(async () => {
    setOverview(await api.get("/api/admin/licenses/overview"));
  }, []);

  useEffect(() => {
    Promise.all([loadPlans(), loadOverview()]).catch((err) => setPageError(err.message));
  }, [loadPlans, loadOverview]);

  const loading = plans === null || overview === null;

  function companiesOnPlan(planId) {
    return (overview || []).filter((company) => company.planId === planId).length;
  }

  const filteredCompanies = (overview || []).filter(
    (company) => !planFilter || String(company.planId) === planFilter
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Abonnementen</h1>

      {pageError && (
        <Card className="border-red-200 bg-red-50 text-red-700">{pageError}</Card>
      )}

      {/* Sectie 1: licentieplannen */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Licentieplannen</h2>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : plans.length === 0 ? (
          <EmptyState
            title="Nog geen licentieplannen"
            description="Maak hieronder het eerste plan aan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Naam</th>
                  <th className="py-2 pr-3 font-medium">Max. gebruikers</th>
                  <th className="py-2 pr-3 font-medium">Max. producten</th>
                  <th className="py-2 pr-3 font-medium">Prijs</th>
                  <th className="py-2 pr-3 font-medium">Klantbedrijven op dit plan</th>
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <PlanRows
                    key={plan.id}
                    plan={plan}
                    companiesCount={companiesOnPlan(plan.id)}
                    editing={editingPlanId === plan.id}
                    showCompanies={companiesPlanId === plan.id}
                    onToggleEdit={() =>
                      setEditingPlanId((prev) => (prev === plan.id ? null : plan.id))
                    }
                    onToggleCompanies={() =>
                      setCompaniesPlanId((prev) => (prev === plan.id ? null : plan.id))
                    }
                    onSaved={async () => {
                      setEditingPlanId(null);
                      await Promise.all([loadPlans(), loadOverview()]);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Nieuw plan</h3>
          <NewPlanForm onCreated={loadPlans} />
        </div>
      </Card>

      {/* Sectie 2: licenties per bedrijf */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Abonnementen per klantbedrijf</h2>
          {!loading && plans.length > 0 && (
            <Select
              label="Filter op plan"
              name="plan-filter"
              className="w-48"
              placeholder="Alle plannen"
              options={plans.map((plan) => ({ value: String(plan.id), label: plan.name }))}
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
            />
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : filteredCompanies.length === 0 ? (
          <EmptyState
            title={planFilter ? "Geen klantbedrijven op dit plan" : "Nog geen klantbedrijven"}
            description={
              planFilter
                ? "Kies een ander plan of wis het filter."
                : "Zodra er klantbedrijven zijn, zie je hier hun abonnementsgebruik."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Bedrijf</th>
                  <th className="py-2 pr-3 font-medium">Partner</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Geldigheid</th>
                  <th className="py-2 pr-3 font-medium">Gebruikers</th>
                  <th className="py-2 pr-3 font-medium">Producten</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((company) => (
                  <CompanyRows
                    key={company.companyId}
                    company={company}
                    plans={plans}
                    editing={editingCompanyId === company.companyId}
                    onToggleEdit={() =>
                      setEditingCompanyId((prev) =>
                        prev === company.companyId ? null : company.companyId
                      )
                    }
                    onSaved={async () => {
                      setEditingCompanyId(null);
                      await loadOverview();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// Tabelrij(en) voor één plan: hoofdregel + optionele uitklap voor bewerken/bedrijven.
function PlanRows({
  plan,
  companiesCount,
  editing,
  showCompanies,
  onToggleEdit,
  onToggleCompanies,
  onSaved
}) {
  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2 pr-3 font-medium text-slate-900">{plan.name}</td>
        <td className="py-2 pr-3">{plan.max_users}</td>
        <td className="py-2 pr-3">{plan.max_products}</td>
        <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{formatPrice(plan.price_monthly_cents) || "—"}</td>
        <td className="py-2 pr-3">{companiesCount}</td>
        <td className="py-2 pr-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs"
              onClick={onToggleEdit}
              aria-expanded={editing}
            >
              {editing ? "Sluiten" : "Bewerken"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-xs"
              onClick={onToggleCompanies}
              aria-expanded={showCompanies}
            >
              {showCompanies ? "Klantbedrijven verbergen" : "Klantbedrijven"}
            </Button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="p-4">
            <PlanEditForm plan={plan} onSaved={onSaved} onCancel={onToggleEdit} />
          </td>
        </tr>
      )}
      {showCompanies && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="p-4">
            <PlanCompanies planId={plan.id} />
          </td>
        </tr>
      )}
    </>
  );
}

// Tabelrij(en) voor één bedrijf in het licentie-overzicht.
function CompanyRows({ company, plans, editing, onToggleEdit, onSaved }) {
  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="py-3 pr-3 font-medium text-slate-900">{company.name}</td>
        <td className="py-3 pr-3 text-slate-600">{company.partnerName || "—"}</td>
        <td className="py-3 pr-3">
          {company.plan ? (
            <Badge variant="info">{company.plan.name}</Badge>
          ) : (
            <Badge variant="neutral">Geen plan</Badge>
          )}
        </td>
        <td className="py-3 pr-3 whitespace-nowrap text-slate-600">
          {formatValidity(company.licenseStart, company.licenseEnd)}
        </td>
        <td className="py-3 pr-3">
          <UsageBar label="Gebruikers" {...company.users} />
        </td>
        <td className="py-3 pr-3">
          <UsageBar label="Producten" {...company.products} />
        </td>
        <td className="py-3 pr-3">
          <LicenseStatusBadge status={company.status} />
        </td>
        <td className="py-3 pr-3">
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={onToggleEdit}
            aria-expanded={editing}
          >
            {editing ? "Sluiten" : "Bewerken"}
          </Button>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={8} className="p-4">
            <CompanyLicenseEditForm
              company={company}
              plans={plans}
              onSaved={onSaved}
              onCancel={onToggleEdit}
            />
          </td>
        </tr>
      )}
    </>
  );
}
