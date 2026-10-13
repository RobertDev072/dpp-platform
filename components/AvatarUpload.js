"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const MAX_MB = 5;

// Profielfoto: de server verkleint naar 256 px WebP (±20 kB) en bewaart alleen die.
export default function AvatarUpload({ me, onChange }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const initials = `${(me.firstName || me.email || "?")[0]}${(me.lastName || "")[0] || ""}`.toUpperCase();

  async function upload(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      toast.error("Gebruik een JPG, PNG, WEBP of GIF.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`De afbeelding is te groot (max ${MAX_MB} MB).`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const { avatarUrl } = await api.upload("/api/media/avatar", form);
      onChange(avatarUrl);
      toast.success("Profielfoto opgeslagen");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete("/api/media/avatar");
      onChange(null);
      toast.success("Profielfoto verwijderd");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Profielfoto</h2>
      <div className="flex items-center gap-4">
        {me.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.avatarUrl} alt="Profielfoto" width={64} height={64} className="h-16 w-16 rounded-full object-cover ring-1 ring-slate-200" />
        ) : (
          <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-lg font-semibold text-white">{initials}</span>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={busy} onClick={() => inputRef.current?.click()}>
              {me.avatarUrl ? "Andere foto kiezen" : "Foto kiezen"}
            </Button>
            {me.avatarUrl && (
              <Button size="sm" variant="outline" disabled={busy} onClick={remove}>
                Verwijderen
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">JPG, PNG, WEBP of GIF, max. {MAX_MB} MB. Wordt automatisch verkleind.</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
    </Card>
  );
}
