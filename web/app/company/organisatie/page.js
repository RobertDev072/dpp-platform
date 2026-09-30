"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import {
  ASSIGNABLE_ROLE_OPTIONS,
  USER_STATUS_BADGE_VARIANTS,
  USER_STATUS_OPTIONS,
  fullName,
  statusLabel
} from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Field from "@/components/ui/Field";
import Select from "@/components/ui/Select";
import SubmitButton from "@/components/ui/SubmitButton";
import FormError from "@/components/ui/FormError";
import EmptyState from "@/components/ui/EmptyState";
import IconButton, { ArchiveIcon, KeyIcon, RestoreIcon } from "@/components/ui/IconButton";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function insertSorted(list, user) {
  const next = [...list.filter((u) => u.id !== user.id), user];
  next.sort((a, b) => a.email.localeCompare(b.email));
  return next;
}

export default function OrganisatiePage() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  // Na aanmaken: ofwel een eenmalig tijdelijk wachtwoord (legacy), ofwel de SSPR-instructie.
  const [createdInfo, setCreatedInfo] = useState(null);
  // Na een admin-reset: het nieuwe tijdelijke wachtwoord, eenmalig getoond.
  const [resetInfo, setResetInfo] = useState(null);
  const [actionError, setActionError] = useState("");

  const form = useForm({
    initial: { email: "", firstName: "", lastName: "", role: "company_user" },
    validators: {
      email: (value) => (EMAIL_PATTERN.test((value || "").trim()) ? null : "Vul een geldig e-mailadres in")
    }
  });

  useEffect(() => {
    api
      .get("/api/users")
      .then((data) => setUsers(data))
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    setFormError(null);
    setCreatedInfo(null);

    if (!form.validateAll()) {
      return;
    }

    setCreating(true);
    try {
      const created = await api.post("/api/users", {
        email: form.values.email.trim(),
        firstName: form.values.firstName.trim() || undefined,
        lastName: form.values.lastName.trim() || undefined,
        role: form.values.role
      });

      setUsers((prev) => insertSorted(prev, created));
      setCreatedInfo({ email: created.email, tempPassword: created.tempPassword || null });
      form.reset();
      toast.success(`Medewerker ${created.email} aangemaakt`);
    } catch (err) {
      const applied = form.applyServerErrors(err);
      if (!applied) {
        if (err.status === 409 && !err.code) {
          // Duplicaat-e-mail komt als kale 409-message terug: onder het e-mailveld tonen.
          form.applyServerErrors({ fieldErrors: { email: [err.message] } });
        } else {
          setFormError(err);
        }
      }
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(user, body) {
    const previous = users;
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...body } : u)));
    try {
      const updated = await api.patch(`/api/users/${user.id}`, body);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
      return true;
    } catch (err) {
      setUsers(previous);
      // O.a. 409 LAST_COMPANY_ADMIN: de server legt in het Nederlands uit waarom het niet mag.
      toast.error(err.message);
      return false;
    }
  }

  // Company admins verwijderen niet (dat kan alleen de platform owner): zij archiveren.
  async function handleArchive(user) {
    const sure = window.confirm(
      `Weet je zeker dat je ${user.email} wilt archiveren? De medewerker kan dan niet meer inloggen.`
    );
    if (!sure) return;
    const ok = await patchUser(user, { status: "archived" });
    if (ok) toast.success(`${user.email} is gearchiveerd`);
  }

  async function handleRestore(user) {
    const ok = await patchUser(user, { status: "active" });
    if (ok) toast.success(`${user.email} is hersteld en kan weer inloggen`);
  }

  async function handleResetPassword(user) {
    setActionError("");
    setResetInfo(null);
    try {
      const result = await api.post(`/api/users/${user.id}/reset-password`);
      if (result.selfService) {
        // Entra-account: geen tijdelijk wachtwoord (onbruikbaar bij native login);
        // de gebruiker herstelt zelf via "Wachtwoord vergeten".
        setResetInfo({ email: user.email, selfServiceMessage: result.message });
      } else {
        setResetInfo({ email: user.email, tempPassword: result.tempPassword });
      }
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Medewerkers</h1>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}
      {actionError && <Card className="border-red-200 bg-red-50 text-red-700">{actionError}</Card>}

      {resetInfo && resetInfo.selfServiceMessage && (
        <Card className="border-blue-200 bg-blue-50 text-blue-800">
          <p className="text-sm">{resetInfo.selfServiceMessage}</p>
        </Card>
      )}

      {resetInfo && resetInfo.tempPassword && (
        <Card className="border-amber-200 bg-amber-50 text-amber-800">
          <p className="mb-2 text-sm font-medium">
            Nieuw tijdelijk wachtwoord voor {resetInfo.email} (wordt maar één keer getoond, deel dit
            zelf veilig met de gebruiker):
          </p>
          <input
            readOnly
            value={resetInfo.tempPassword}
            onClick={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
        </Card>
      )}

      {createdInfo && !createdInfo.tempPassword && (
        <Card className="border-blue-200 bg-blue-50 text-blue-800">
          <p className="text-sm">
            Laat <span className="font-medium">{createdInfo.email}</span> het wachtwoord instellen via{" "}
            <span className="font-medium">Wachtwoord vergeten</span> op de loginpagina.
          </p>
        </Card>
      )}

      {createdInfo && createdInfo.tempPassword && (
        <Card className="border-amber-200 bg-amber-50 text-amber-800">
          <p className="mb-2 text-sm font-medium">
            Tijdelijk wachtwoord voor {createdInfo.email} (wordt maar één keer getoond, deel dit zelf
            veilig met de gebruiker):
          </p>
          <input
            readOnly
            value={createdInfo.tempPassword}
            onClick={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
          <p className="mt-2 text-xs">
            De gebruiker kan het wachtwoord daarna zelf wijzigen via Wachtwoord vergeten op de
            loginpagina.
          </p>
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuwe medewerker</h2>
        <form onSubmit={handleCreate} noValidate className="space-y-4">
          <FormError error={formError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="E-mail"
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="naam@bedrijf.nl"
              value={form.values.email}
              onChange={(e) => form.setValue("email", e.target.value)}
              onBlur={() => form.onBlur("email")}
              error={form.errors.email}
            />
            <Select
              label="Rol"
              name="role"
              required
              options={ASSIGNABLE_ROLE_OPTIONS}
              value={form.values.role}
              onChange={(e) => form.setValue("role", e.target.value)}
              error={form.errors.role}
            />
            <Field
              label="Voornaam"
              name="firstName"
              autoComplete="off"
              placeholder="Bijv. Anna"
              value={form.values.firstName}
              onChange={(e) => form.setValue("firstName", e.target.value)}
              error={form.errors.firstName}
            />
            <Field
              label="Achternaam"
              name="lastName"
              autoComplete="off"
              placeholder="Bijv. de Vries"
              value={form.values.lastName}
              onChange={(e) => form.setValue("lastName", e.target.value)}
              error={form.errors.lastName}
            />
          </div>

          <p className="text-xs text-slate-400">
            De nieuwe medewerker stelt het eigen wachtwoord in via Wachtwoord vergeten op de loginpagina.
          </p>

          <SubmitButton loading={creating}>Aanmaken</SubmitButton>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Medewerkers</h2>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : users.length === 0 ? (
          <EmptyState
            title="Nog geen medewerkers"
            description="Maak hierboven de eerste medewerker aan voor je organisatie."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3">E-mail</th>
                  <th className="py-2 pr-3">Naam</th>
                  <th className="py-2 pr-3">Rol</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Status wijzigen</th>
                  <th className="py-2 pr-3">Acties</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{user.email}</td>
                    <td className="py-2 pr-3">{fullName(user) || "—"}</td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Rol van ${user.email}`}
                        value={user.role}
                        onChange={(e) => patchUser(user, { role: e.target.value })}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      >
                        {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={USER_STATUS_BADGE_VARIANTS[user.status] || "neutral"}>
                        {statusLabel(user.status)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Status van ${user.email}`}
                        value={user.status}
                        onChange={(e) => patchUser(user, { status: e.target.value })}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      >
                        {USER_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <IconButton
                          title="Reset wachtwoord"
                          onClick={() => handleResetPassword(user)}
                        >
                          <KeyIcon />
                        </IconButton>
                        {user.status === "archived" ? (
                          <IconButton title="Herstellen" onClick={() => handleRestore(user)}>
                            <RestoreIcon />
                          </IconButton>
                        ) : (
                          <IconButton
                            title="Archiveren"
                            tone="danger"
                            onClick={() => handleArchive(user)}
                          >
                            <ArchiveIcon />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
