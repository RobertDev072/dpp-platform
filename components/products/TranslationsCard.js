"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

// Talen voor paspoortteksten (BCP 47). De EU-talen plus veelgebruikte handelstalen.
export const LANGUAGE_OPTIONS = [
  { value: "nl-NL", label: "Nederlands (Nederland)" },
  { value: "nl-BE", label: "Nederlands (België)" },
  { value: "en-GB", label: "Engels" },
  { value: "de-DE", label: "Duits" },
  { value: "fr-FR", label: "Frans" },
  { value: "fr-BE", label: "Frans (België)" },
  { value: "es-ES", label: "Spaans" },
  { value: "it-IT", label: "Italiaans" },
  { value: "pl-PL", label: "Pools" },
  { value: "pt-PT", label: "Portugees" },
  { value: "da-DK", label: "Deens" },
  { value: "sv-SE", label: "Zweeds" },
  { value: "fi-FI", label: "Fins" },
  { value: "cs-CZ", label: "Tsjechisch" },
  { value: "ro-RO", label: "Roemeens" },
  { value: "hu-HU", label: "Hongaars" },
  { value: "el-GR", label: "Grieks" },
  { value: "bg-BG", label: "Bulgaars" },
  { value: "hr-HR", label: "Kroatisch" },
  { value: "sk-SK", label: "Slowaaks" },
  { value: "sl-SI", label: "Sloveens" },
  { value: "et-EE", label: "Ests" },
  { value: "lv-LV", label: "Lets" },
  { value: "lt-LT", label: "Litouws" },
  { value: "ga-IE", label: "Iers" },
  { value: "mt-MT", label: "Maltees" }
];

export function parseSpecList(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const labelOf = (code) => LANGUAGE_OPTIONS.find((o) => o.value === code)?.label || code;

// Vertalingen van naam en omschrijving. Staat binnen het basisformulier, dus zonder eigen
// <form>: elke vertaling wordt los opgeslagen met een eigen knop.
export default function TranslationsCard({ productId, baseLanguage, onSaved }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [newLanguage, setNewLanguage] = useState("");
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api
      .get(`/api/products/${productId}/translations`)
      .then((data) => setItems(data.translations.map((t) => ({ ...t, name: t.name || "", description: t.description || "" }))))
      .catch((err) => setLoadError(err.message));
  }, [productId]);

  function update(language, key, value) {
    setItems((prev) => prev.map((t) => (t.language === language ? { ...t, [key]: value, dirty: true } : t)));
  }

  async function save(item) {
    setBusy(item.language);
    try {
      await api.put(`/api/products/${productId}/translations/${item.language}`, {
        name: item.name.trim() || null,
        description: item.description.trim() || null
      });
      setItems((prev) => prev.map((t) => (t.language === item.language ? { ...t, dirty: false } : t)));
      toast.success(`Vertaling ${labelOf(item.language)} opgeslagen`);
      await onSaved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(item) {
    setBusy(item.language);
    try {
      if (!item.isNew) await api.delete(`/api/products/${productId}/translations/${item.language}`);
      setItems((prev) => prev.filter((t) => t.language !== item.language));
      if (!item.isNew) toast.success(`Vertaling ${labelOf(item.language)} verwijderd`);
      await onSaved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  function add() {
    if (!newLanguage) return;
    setItems((prev) => [...prev, { language: newLanguage, name: "", description: "", isNew: true, dirty: true }]);
    setNewLanguage("");
  }

  const used = new Set([baseLanguage, ...(items || []).map((t) => t.language)]);
  const available = LANGUAGE_OPTIONS.filter((o) => !used.has(o.value));

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Vertalingen</h2>
        <p className="text-xs text-slate-500">
          Productnaam en omschrijving in andere talen. Ze komen meertalig in het machineleesbare paspoort.
        </p>
      </div>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
      {items === null && !loadError && <p className="text-sm text-slate-400">Laden…</p>}
      {items?.map((item) => (
        <div key={item.language} className="space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-800">{labelOf(item.language)}</p>
          <Field
            label="Productnaam"
            name={`tr-name-${item.language}`}
            maxLength={200}
            value={item.name}
            onChange={(e) => update(item.language, "name", e.target.value)}
          />
          <div>
            <label htmlFor={`tr-desc-${item.language}`} className="block text-sm font-medium text-slate-700">
              Omschrijving
            </label>
            <textarea
              id={`tr-desc-${item.language}`}
              rows={3}
              value={item.description}
              onChange={(e) => update(item.language, "description", e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="accent" loading={busy === item.language} disabled={!item.dirty} onClick={() => save(item)}>
              Vertaling opslaan
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy === item.language} onClick={() => remove(item)}>
              Verwijderen
            </Button>
          </div>
        </div>
      ))}
      {items && available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label="Taal toevoegen"
            name="tr-new-language"
            placeholder="Kies een taal…"
            options={available}
            value={newLanguage}
            onChange={(e) => setNewLanguage(e.target.value)}
            className="w-64"
          />
          <Button type="button" variant="outline" disabled={!newLanguage} onClick={add}>
            Toevoegen
          </Button>
        </div>
      )}
    </Card>
  );
}
