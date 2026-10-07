"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

// De backend accepteert een data-URI van max ~200KB; na verkleinen naar 256px
// past vrijwel elk logo daar ruim binnen.
const MAX_LOGO_DIMENSION = 256;
const MAX_DATA_URI_LENGTH = 200 * 1024;

function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Kon het bestand niet lezen."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Dit bestand is geen geldige afbeelding."));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function InstellingenPage() {
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [me, setMe] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [saving, setSaving] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [formError, setFormError] = useState(null);
  const [logoError, setLogoError] = useState("");
  // undefined = ongewijzigd; string = nieuw gekozen logo (data-URI).
  const [newLogo, setNewLogo] = useState(undefined);

  const form = useForm({
    initial: { name: "" },
    validators: {
      name: (value) => ((value || "").trim().length >= 2 ? null : "Vul een bedrijfsnaam in (minimaal 2 tekens)")
    }
  });

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/auth/me")
      .then((meData) => {
        if (cancelled) {
          return null;
        }
        setMe(meData);
        if (meData.role !== "company_admin") {
          return null;
        }
        return api.get("/api/company").then((companyData) => {
          if (!cancelled) {
            setCompany(companyData);
            form.setValue("name", companyData.name || "");
          }
        });
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
    // Alleen bij mount laden; form.setValue is stabiel genoeg binnen deze closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    setLogoError("");
    if (!file) {
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file, MAX_LOGO_DIMENSION);
      if (dataUrl.length > MAX_DATA_URI_LENGTH) {
        setLogoError("Het logo is ook na verkleinen groter dan 200 KB. Kies een eenvoudiger afbeelding.");
        return;
      }
      setNewLogo(dataUrl);
    } catch (err) {
      setLogoError(err.message);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    if (!form.validateAll()) {
      return;
    }

    const body = { name: form.values.name.trim() };
    if (typeof newLogo === "string") {
      body.logo = newLogo;
    }

    setSaving(true);
    try {
      await api.patch("/api/company", body);
      toast.success("Bedrijfsprofiel opgeslagen");
      // Herladen zodat het logo en de bedrijfsnaam in de zijbalk meteen kloppen.
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        setFormError(err);
      }
      setSaving(false);
    }
  }

  async function handleRemoveLogo() {
    setLogoError("");
    setRemovingLogo(true);
    try {
      await api.patch("/api/company", { logo: null });
      toast.success("Logo verwijderd");
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      setLogoError(err.message);
      setRemovingLogo(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Bedrijfsinstellingen</h1>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Bedrijfsinstellingen</h1>
        <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>
      </div>
    );
  }

  if (me && me.role !== "company_admin") {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Bedrijfsinstellingen</h1>
        <Card>
          <p className="text-sm text-slate-600">
            Alleen Bedrijfsbeheerders kunnen bedrijfsinstellingen beheren. Vraag een beheerder
            van je organisatie om wijzigingen door te voeren.
          </p>
        </Card>
      </div>
    );
  }

  const previewLogo = typeof newLogo === "string" ? newLogo : company?.logo || null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Bedrijfsinstellingen</h1>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Bedrijfsprofiel</h2>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <FormError error={formError} />

          <Field
            label="Bedrijfsnaam"
            name="name"
            required
            autoComplete="organization"
            value={form.values.name}
            onChange={(e) => form.setValue("name", e.target.value)}
            onBlur={() => form.onBlur("name")}
            error={form.errors.name}
            className="max-w-md"
          />

          <div>
            <span className="block text-sm font-medium text-slate-700">Logo</span>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {previewLogo ? (
                <img
                  src={previewLogo}
                  alt="Voorbeeld van het bedrijfslogo"
                  className="h-16 w-16 rounded-lg border border-slate-200 bg-white object-contain p-1"
                />
              ) : (
                <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
                  Geen logo
                </div>
              )}
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  id="logo"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700"
                />
                <p className="text-xs text-slate-400">
                  PNG, JPG of WebP; wordt automatisch verkleind naar maximaal {MAX_LOGO_DIMENSION}x
                  {MAX_LOGO_DIMENSION} pixels.
                </p>
                {company?.logo && typeof newLogo !== "string" && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    disabled={removingLogo}
                    className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                  >
                    {removingLogo ? "Bezig..." : "Logo verwijderen"}
                  </button>
                )}
                {typeof newLogo === "string" && (
                  <button
                    type="button"
                    onClick={() => setNewLogo(undefined)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    Nieuw logo annuleren
                  </button>
                )}
              </div>
            </div>
            {logoError && <p className="mt-2 text-sm text-red-600">{logoError}</p>}
          </div>

          <SubmitButton loading={saving}>Opslaan</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
