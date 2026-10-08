"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import IconButton, { TrashIcon } from "@/components/ui/IconButton";
import { useToast } from "@/components/ui/Toast";
import { DOCUMENT_CATEGORY_OPTIONS, documentCategoryLabel, documentExpiry, formatFileSize } from "./documentUtils";

// Zelfde whitelist als de backend (products.routes.js): controle vóór de upload
// voorkomt een zinloze POST van 10 MB die toch een 400 oplevert.
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp"
];
const ACCEPT = ".pdf,image/jpeg,image/png,image/svg+xml,image/webp";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function DocumentsTab({ productId }) {
  const toast = useToast();
  // null = nog aan het laden; [] = geladen maar leeg.
  const [documents, setDocuments] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadDocuments = useCallback(async () => {
    const data = await api.get(`/api/products/${productId}/documents`);
    setDocuments(data);
  }, [productId]);

  useEffect(() => {
    loadDocuments().catch((err) => setLoadError(err.message));
  }, [loadDocuments]);

  async function handleDelete(documentId) {
    if (!window.confirm("Weet je zeker dat je dit document wilt verwijderen?")) {
      return;
    }
    setDeletingId(documentId);
    try {
      await api.delete(`/api/products/${productId}/documents/${documentId}`);
      toast.success("Document verwijderd");
      await loadDocuments();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleArchive(doc) {
    const archived = !doc.archived_at;
    try {
      await api.patch(`/api/products/${productId}/documents/${doc.id}`, { archived });
      toast.success(archived ? "Document gearchiveerd" : "Document hersteld");
      await loadDocuments();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <UploadCard
        productId={productId}
        onUploaded={async () => {
          toast.success("Document geüpload");
          await loadDocuments();
        }}
      />

      <ExternalLinkCard
        productId={productId}
        onCreated={async () => {
          toast.success("Document toegevoegd");
          await loadDocuments();
        }}
      />

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Documenten</h2>
        {documents === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            title="Nog geen documenten"
            description="Upload een handleiding, certificaat of productbeschrijving."
          />
        ) : (
          <DocumentList
            productId={productId}
            documents={documents}
            deletingId={deletingId}
            onDelete={handleDelete}
            onArchive={handleArchive}
          />
        )}
      </Card>
    </div>
  );
}

function UploadCard({ productId, onUploaded }) {
  const form = useForm({
    initial: { title: "", category: "document", isPublic: false, version: "", language: "", validUntil: "" },
    validators: {
      title: (value) => (String(value || "").trim() ? null : "Vul een titel in")
    }
  });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState(null);

  function selectFile(candidate) {
    if (!ALLOWED_MIME_TYPES.includes(candidate.type)) {
      setFile(null);
      setFileError("Dit bestandstype wordt niet ondersteund. Gebruik PDF, JPG, PNG, SVG of WEBP.");
      return;
    }
    if (candidate.size > MAX_FILE_SIZE) {
      const sizeMb = (candidate.size / (1024 * 1024)).toFixed(1).replace(".", ",");
      setFile(null);
      setFileError(
        `Het bestand is te groot (${sizeMb} MB, max 10 MB). Verklein de PDF of splits het document.`
      );
      return;
    }
    setFile(candidate);
    setFileError("");
  }

  function handleFileChange(event) {
    const chosen = event.target.files?.[0];
    // Reset zodat hetzelfde bestand opnieuw gekozen kan worden na een fout.
    event.target.value = "";
    if (chosen) {
      selectFile(chosen);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) {
      selectFile(dropped);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    const fieldsValid = form.validateAll();
    if (!file) {
      setFileError((prev) => prev || "Kies eerst een bestand.");
      return;
    }
    if (!fieldsValid) {
      return;
    }

    setUploading(true);
    try {
      await api.directUpload({
        requestUrl: `/api/products/${productId}/documents/upload-url`,
        completeUrl: `/api/products/${productId}/documents/upload`,
        file,
        fields: {
          title: form.values.title.trim(),
          category: form.values.category,
          isPublic: Boolean(form.values.isPublic),
          version: form.values.version.trim() || null,
          language: form.values.language.trim() || null,
          validUntil: form.values.validUntil || null
        }
      });

      form.reset();
      setFile(null);
      setFileError("");
      await onUploaded();
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        // Groottes-/typefouten van de server komen als losse message: prominent tonen.
        setFormError(err);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-slate-900">Document uploaden</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormError error={formError} />

        <div>
          <label
            htmlFor="document-file"
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragActive
                ? "border-blue-500 bg-blue-50"
                : fileError
                  ? "border-red-300 bg-red-50/50"
                  : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40"
            }`}
          >
            <input
              id="document-file"
              type="file"
              accept={ACCEPT}
              onChange={handleFileChange}
              disabled={uploading}
              className="sr-only"
            />
            {file ? (
              <>
                <span className="text-sm font-medium text-slate-900">
                  {file.name}{" "}
                  <span className="font-normal text-slate-500">({formatFileSize(file.size)})</span>
                </span>
                <span className="text-xs text-slate-500">
                  Klik of sleep om een ander bestand te kiezen
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-slate-700">
                  Klik om een bestand te kiezen of sleep het hierheen
                </span>
                <span className="text-xs text-slate-500">PDF, JPG, PNG, SVG of WEBP — max 10 MB</span>
              </>
            )}
          </label>
          {fileError && <p className="mt-1 text-sm text-red-600">{fileError}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Titel"
            name="title"
            required
            placeholder="Bijv. Gebruikershandleiding"
            value={form.values.title}
            onChange={(e) => form.setValue("title", e.target.value)}
            onBlur={() => form.onBlur("title")}
            error={form.errors.title}
          />
          <Select
            label="Categorie"
            name="category"
            options={DOCUMENT_CATEGORY_OPTIONS}
            value={form.values.category}
            onChange={(e) => form.setValue("category", e.target.value)}
            error={form.errors.category}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Versie"
            name="version"
            placeholder="Bijv. 2.1"
            maxLength={30}
            value={form.values.version}
            onChange={(e) => form.setValue("version", e.target.value)}
          />
          <Field
            label="Taal"
            name="language"
            placeholder="nl, en, de…"
            maxLength={10}
            value={form.values.language}
            onChange={(e) => form.setValue("language", e.target.value)}
          />
          <Field
            label="Vervaldatum (optioneel)"
            name="validUntil"
            type="date"
            value={form.values.validUntil}
            onChange={(e) => form.setValue("validUntil", e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={form.values.isPublic}
            onChange={(e) => form.setValue("isPublic", e.target.checked)}
          />
          Publiek zichtbaar op het productpaspoort
        </label>

        <SubmitButton disabled={uploading}>
          {uploading ? (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
              Uploaden...
            </>
          ) : (
            "Document uploaden"
          )}
        </SubmitButton>
      </form>
    </Card>
  );
}

function ExternalLinkCard({ productId, onCreated }) {
  const [open, setOpen] = useState(false);
  const form = useForm({
    initial: { type: "", title: "", storageUrl: "", isPublic: false },
    validators: {
      title: (value) => (String(value || "").trim() ? null : "Vul een titel in"),
      storageUrl: (value) => (String(value || "").trim() ? null : "Vul een URL in")
    }
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (!form.validateAll()) {
      return;
    }

    setSaving(true);
    try {
      await api.post(`/api/products/${productId}/documents`, {
        type: form.values.type,
        title: form.values.title,
        storageUrl: form.values.storageUrl,
        isPublic: form.values.isPublic
      });
      form.reset();
      await onCreated();
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        setFormError(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-slate-900"
      >
        Of voeg een externe link toe
        <span aria-hidden="true" className="text-slate-400">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
          <FormError error={formError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Titel"
              name="link-title"
              required
              value={form.values.title}
              onChange={(e) => form.setValue("title", e.target.value)}
              onBlur={() => form.onBlur("title")}
              error={form.errors.title}
            />
            <Field
              label="Type"
              name="link-type"
              placeholder="Bijv. certificaat"
              value={form.values.type}
              onChange={(e) => form.setValue("type", e.target.value)}
              error={form.errors.type}
            />
            <Field
              label="URL"
              name="link-storageUrl"
              required
              placeholder="https://..."
              className="sm:col-span-2"
              value={form.values.storageUrl}
              onChange={(e) => form.setValue("storageUrl", e.target.value)}
              onBlur={() => form.onBlur("storageUrl")}
              error={form.errors.storageUrl}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.values.isPublic}
              onChange={(e) => form.setValue("isPublic", e.target.checked)}
            />
            Publiek zichtbaar op het productpaspoort
          </label>

          <SubmitButton loading={saving}>Link toevoegen</SubmitButton>
        </form>
      )}
    </Card>
  );
}

function DocumentList({ productId, documents, deletingId, onDelete, onArchive }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2 pr-3 font-medium">Titel</th>
            <th className="py-2 pr-3 font-medium">Categorie</th>
            <th className="py-2 pr-3 font-medium">Versie</th>
            <th className="py-2 pr-3 font-medium">Vervaldatum</th>
            <th className="py-2 pr-3 font-medium">Zichtbaarheid</th>
            <th className="py-2 pr-3 font-medium">Toegevoegd</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Acties</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const isUpload = Boolean(doc.blob_name);
            const openUrl = isUpload
              ? `/api/products/${productId}/documents/${doc.id}/file`
              : doc.storage_url;

            return (
              <tr key={doc.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-slate-400">
                      <DocumentTypeIcon doc={doc} />
                    </span>
                    <span className="font-medium text-slate-900">{doc.title}</span>
                    {doc.archived_at && <Badge variant="neutral">Gearchiveerd</Badge>}
                  </div>
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {documentCategoryLabel(doc.category) || "—"}
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {doc.version ? `v${doc.version}` : "—"}
                  {doc.language ? <span className="ml-1 uppercase text-slate-400">{doc.language}</span> : null}
                  {isUpload && <span className="block text-xs text-slate-400">{formatFileSize(doc.file_size)}</span>}
                </td>
                <td className="py-2 pr-3">
                  <ExpiryCell validUntil={doc.valid_until} />
                </td>
                <td className="py-2 pr-3">
                  {doc.is_public ? (
                    <Badge variant="success">Publiek</Badge>
                  ) : (
                    <Badge variant="neutral">Privé</Badge>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-600">{formatDate(doc.created_at)}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <IconButton
                      title="Openen"
                      tone="primary"
                      disabled={!openUrl}
                      onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
                    >
                      <OpenIcon />
                    </IconButton>
                    <IconButton
                      title={doc.archived_at ? "Herstellen" : "Archiveren (niet meer op paspoort)"}
                      onClick={() => onArchive(doc)}
                    >
                      <ArchiveIcon />
                    </IconButton>
                    <IconButton
                      title="Verwijderen"
                      tone="danger"
                      disabled={deletingId === doc.id}
                      onClick={() => onDelete(doc.id)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExpiryCell({ validUntil }) {
  const e = documentExpiry(validUntil);
  if (e.status === "none") return <span className="text-slate-400">—</span>;
  const variant = e.status === "expired" ? "danger" : e.status === "expiring" ? "warning" : "neutral";
  return (
    <span title={e.label}>
      <Badge variant={variant}>{e.status === "valid" ? e.date : e.label}</Badge>
    </span>
  );
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="4" rx="1" />
      <path d="M4 7.5V15a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15V7.5M8 11h4" />
    </svg>
  );
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function DocumentTypeIcon({ doc }) {
  if (!doc.blob_name && doc.storage_url) {
    return <LinkIcon />;
  }
  if (doc.mime_type?.startsWith("image/")) {
    return <PhotoIcon />;
  }
  return <DocIcon />;
}

// Iconen in dezelfde 18px stroke-stijl als components/ui/IconButton.js.
function Svg({ children }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// PDF/overige geüploade bestanden: documenticoon.
function DocIcon() {
  return (
    <Svg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Svg>
  );
}

// Geüploade afbeeldingen: foto-icoon.
function PhotoIcon() {
  return (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </Svg>
  );
}

// Externe links: ketting-icoon.
function LinkIcon() {
  return (
    <Svg>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

// "Openen": external-link-icoon.
function OpenIcon() {
  return (
    <Svg>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </Svg>
  );
}
