"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import { useToast } from "@/components/ui/Toast";

const SCHEME_OPTIONS = [
  { value: "lei", label: "LEI (Legal Entity Identifier)" },
  { value: "gln", label: "GLN (GS1 Global Location Number)" },
  { value: "eori", label: "EORI-nummer" },
  { value: "vat", label: "Btw-nummer" },
  { value: "kvk", label: "KvK-nummer" },
  { value: "duns", label: "DUNS-nummer" },
  { value: "other", label: "Anders" }
];

const PLACEHOLDERS = {
  lei: "Bijv. 724500VKKSH9QOLTFR81",
  gln: "13 cijfers",
  eori: "Bijv. NL123456789",
  vat: "Bijv. NL123456789B01",
  kvk: "8 cijfers",
  duns: "9 cijfers",
  other: ""
};

// Identificatie als marktdeelnemer: komt als economicOperatorId op elk paspoort van het
// bedrijf. De server controleert het formaat (en bij LEI/GLN het controlecijfer).
export default function OperatorIdCard({ company }) {
  const toast = useToast();
  const [scheme, setScheme] = useState(company.economic_operator_id_scheme || "");
  const [value, setValue] = useState(company.economic_operator_id || "");
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setFieldError("");
    if (value.trim() && !scheme) {
      setFieldError("Kies eerst het soort identificatie");
      return;
    }
    setSaving(true);
    try {
      const body = value.trim()
        ? { economicOperatorIdScheme: scheme, economicOperatorId: value.trim() }
        : { economicOperatorIdScheme: null, economicOperatorId: null };
      const updated = await api.patch("/api/company", body);
      setValue(updated.economic_operator_id || "");
      setScheme(updated.economic_operator_id_scheme || "");
      toast.success(value.trim() ? "Identificatie opgeslagen; paspoorten worden bijgewerkt" : "Identificatie verwijderd");
    } catch (err) {
      const message = err.fieldErrors?.economicOperatorId?.[0];
      if (message) setFieldError(message);
      else setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900">Identificatie als marktdeelnemer</h2>
      <p className="mb-4 mt-1 text-xs text-slate-500">
        Staat op elk productpaspoort als <code>economicOperatorId</code>. Gebruik bij voorkeur een LEI of GLN.
      </p>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormError error={error} />
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Select
            label="Soort identificatie"
            name="operator-scheme"
            placeholder="Kies…"
            options={SCHEME_OPTIONS}
            value={scheme}
            onChange={(e) => setScheme(e.target.value)}
          />
          <Field
            label="Identificatie"
            name="operator-id"
            autoComplete="off"
            placeholder={PLACEHOLDERS[scheme] || ""}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={fieldError}
          />
        </div>
        <SubmitButton loading={saving}>Opslaan</SubmitButton>
      </form>
    </Card>
  );
}
