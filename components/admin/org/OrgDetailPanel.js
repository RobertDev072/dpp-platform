"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { homeHrefForRole } from "@/lib/nav";
import {
  ASSIGNABLE_ROLE_OPTIONS,
  PARTNER_ROLE_OPTIONS,
  USER_STATUS_BADGE_VARIANTS,
  USER_STATUS_OPTIONS,
  fullName,
  statusLabel
} from "@/lib/labels";
import Badge from "@/components/ui/Badge";
import Button, { ButtonLink } from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { XIcon } from "@/components/ui/icons";
import { formatRelativeTime, initialsOf } from "@/components/admin/listUtils";
import NewUserForm from "./NewUserForm";
import { CompanyStatusBadge, InlineError, KindBadge, RoleBadge, RowSkeleton } from "./orgUi";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("nl-NL") : "—";
}

function Fact({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="border-t border-slate-100 px-5 py-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

// Pad boven in het paneel: Partner › Bedrijf. Klikbaar zodat je omhoog kunt navigeren.
function Path({ items, onSelect }) {
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <nav aria-label="Plaats in de organisatie" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {visible.map((item, index) => (
        <span key={`${item.kind}-${item.id}`} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden="true">›</span>}
          <button type="button" className="hover:text-slate-800 hover:underline" onClick={() => onSelect(item)}>
            {item.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function CompanyDetail({ company, onSelect, onChanged }) {
  const [adding, setAdding] = useState(false);
  const isPartner = company.kind === "partner";
  const standalone = !isPartner && !company.partner_id;

  return (
    <>
      <div className="px-5 pb-4">
        <Path
          items={[
            !isPartner && company.partner_id && { kind: "partner", id: company.partner_id, label: company.partner_name }
          ]}
          onSelect={onSelect}
        />
        <h2 className="text-lg font-semibold text-slate-900">{company.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <KindBadge kind={company.kind} standalone={standalone} />
          <CompanyStatusBadge status={company.status} />
        </div>
      </div>

      <Section title="Overzicht">
        <dl>
          {isPartner ? (
            <>
              <Fact label="Klantbedrijven">{company.customer_count}</Fact>
              <Fact label="Partner Admins">{company.user_count}</Fact>
              <Fact label="Gebruikers bij klanten">{company.customer_user_count}</Fact>
            </>
          ) : (
            <>
              <Fact label="Partner">{company.partner_name || "Geen (zelfstandig)"}</Fact>
              <Fact label="Abonnement">{company.plan_name || "Geen plan"}</Fact>
              <Fact label="Gebruikers">
                {company.user_count}
                {company.max_users ? ` / ${company.max_users}` : ""}
              </Fact>
              <Fact label="Medewerkers">{company.employee_count}</Fact>
              <Fact label="Producten">
                {company.product_count}
                {company.max_products ? ` / ${company.max_products}` : ""}
              </Fact>
              <Fact label="Licentie">
                {company.license_start || company.license_end
                  ? `${formatDate(company.license_start)} – ${formatDate(company.license_end)}`
                  : "—"}
              </Fact>
            </>
          )}
          <Fact label="Laatste activiteit">{formatRelativeTime(company.last_activity, "Nog geen")}</Fact>
          <Fact label="Aangemaakt">{formatDate(company.created_at)}</Fact>
        </dl>
      </Section>

      <Section title={isPartner ? "Partner Admins" : "Bedrijfsbeheerders"}>
        {company.admins.length === 0 ? (
          <p className="text-sm text-slate-500">Nog geen beheerders.</p>
        ) : (
          <ul className="space-y-1">
            {company.admins.map((admin) => (
              <li key={admin.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "user", id: admin.id })}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">{fullName(admin) || admin.email}</span>
                  <span className="block truncate text-xs text-slate-500">{admin.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Acties">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="accent" onClick={() => setAdding(true)}>
            {isPartner ? "Partner Admin toevoegen" : "Gebruiker toevoegen"}
          </Button>
          {isPartner ? (
            <ButtonLink size="sm" href="/admin/partners">
              Naar partners
            </ButtonLink>
          ) : (
            <>
              <ButtonLink size="sm" href={`/admin/companies/${company.id}`}>
                Bedrijfsoverzicht
              </ButtonLink>
              <ButtonLink size="sm" href={`/admin/companies/${company.id}/uitnodigen`}>
                Beheerder uitnodigen
              </ButtonLink>
              <ButtonLink size="sm" href={`/admin/products?companyId=${company.id}`}>
                Producten
              </ButtonLink>
            </>
          )}
        </div>
      </Section>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={isPartner ? "Partner Admin toevoegen" : "Gebruiker toevoegen"}
        description={company.name}
        size="lg"
      >
        <NewUserForm company={company} onCreated={onChanged} />
      </Modal>
    </>
  );
}

function UserDetail({ user, onSelect, onChanged }) {
  const toast = useToast();
  const [resetInfo, setResetInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const name = fullName(user);
  const isOwner = user.role === "platform_owner";
  const roleOptions = user.company_kind === "partner" ? PARTNER_ROLE_OPTIONS : ASSIGNABLE_ROLE_OPTIONS;
  const canImpersonate = !isOwner && user.status === "active";

  async function patch(body) {
    setBusy(true);
    try {
      await api.patch(`/api/users/${user.id}`, body);
      toast.success(body.status === "deleted" ? `${user.email} is verwijderd` : "Wijziging opgeslagen");
      onChanged(body.status === "deleted");
    } catch (err) {
      // O.a. 409 LAST_COMPANY_ADMIN: de server legt uit waarom het niet mag.
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    const sure = window.confirm(
      `Weet je zeker dat je ${user.email} wilt verwijderen? Het account kan daarna nooit meer inloggen ` +
        "en dit kan niet ongedaan gemaakt worden."
    );
    if (sure) patch({ status: "deleted" });
  }

  async function handleResetMfa() {
    const sure = window.confirm(
      `Tweestapsverificatie van ${user.email} uitzetten? Alle sessies van dit account worden beëindigd; ` +
        "de gebruiker moet daarna zelf opnieuw koppelen."
    );
    if (!sure) return;
    try {
      await api.post(`/api/users/${user.id}/mfa/reset`);
      toast.success(`Tweestapsverificatie van ${user.email} staat uit`);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleResetPassword() {
    try {
      const result = await api.post(`/api/users/${user.id}/reset-password`);
      if (result?.selfService) {
        setResetInfo({
          message:
            result.message ||
            `${user.email} moet het wachtwoord zelf opnieuw instellen via "Wachtwoord vergeten" op de inlogpagina.`
        });
      } else if (result?.tempPassword) {
        setResetInfo({ tempPassword: result.tempPassword });
      } else {
        toast.error("Onverwacht antwoord van de server bij het resetten van het wachtwoord");
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(resetInfo.tempPassword);
      toast.success("Wachtwoord gekopieerd naar het klembord");
    } catch {
      toast.error("Kopiëren mislukt — selecteer het wachtwoord en kopieer handmatig");
    }
  }

  async function handleImpersonate() {
    if (!window.confirm(`Je logt in als ${user.email}. Alle acties worden vastgelegd in het auditlog.`)) return;
    try {
      await api.post(`/api/admin/impersonate/${user.id}`);
      window.location.href = homeHrefForRole(user.role);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const companyIsPartner = user.company_kind === "partner";

  return (
    <>
      <div className="px-5 pb-4">
        <Path
          items={[
            user.partner_id && { kind: "partner", id: user.partner_id, label: user.partner_name },
            user.company_id && !companyIsPartner && { kind: "customer", id: user.company_id, label: user.company_name }
          ]}
          onSelect={onSelect}
        />
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
            {initialsOf(name || user.email)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">{name || user.email}</h2>
            <p className="truncate text-sm text-slate-500">{user.email}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RoleBadge role={user.role} />
          <Badge variant={USER_STATUS_BADGE_VARIANTS[user.status] || "neutral"}>{statusLabel(user.status)}</Badge>
          {user.mfa_enabled && <Badge variant="success">MFA aan</Badge>}
        </div>
      </div>

      <Section title="Account">
        <dl>
          <Fact label="Bedrijf">{user.company_name || (isOwner ? "VeriPasso (platform)" : "—")}</Fact>
          <Fact label="Tweestapsverificatie">{user.mfa_enabled ? "Aan" : "Uit"}</Fact>
          <Fact label="Laatste login">{formatRelativeTime(user.last_login, "Nog nooit")}</Fact>
          <Fact label="Laatste activiteit">{formatRelativeTime(user.last_activity, "Nog nooit")}</Fact>
          <Fact label="Aangemaakt">{formatDate(user.created_at)}</Fact>
        </dl>
      </Section>

      {isOwner ? (
        <Section title="Acties">
          <p className="text-sm text-slate-500">Platform Owner-accounts zijn beschermd en worden hier niet beheerd.</p>
        </Section>
      ) : (
        <>
          <Section title="Rol en status">
            <div className="grid gap-3">
              <Select
                label="Rol"
                name={`org-user-role-${user.id}`}
                options={roleOptions}
                help={companyIsPartner ? "In een partnerbedrijf is alleen de rol Partner Admin mogelijk." : undefined}
                value={user.role}
                disabled={busy}
                onChange={(e) => patch({ role: e.target.value })}
              />
              <Select
                label="Status"
                name={`org-user-status-${user.id}`}
                options={USER_STATUS_OPTIONS}
                value={user.status}
                disabled={busy}
                onChange={(e) => patch({ status: e.target.value })}
              />
            </div>
          </Section>

          <Section title="Acties">
            <div className="flex flex-wrap gap-2">
              {canImpersonate && (
                <Button size="sm" variant="outline" onClick={handleImpersonate}>
                  Inloggen als
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleResetPassword}>
                Wachtwoord resetten
              </Button>
              {user.mfa_enabled && (
                <Button size="sm" variant="outline" onClick={handleResetMfa}>
                  MFA resetten
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={handleDelete} disabled={busy}>
                Verwijderen
              </Button>
            </div>

            {resetInfo?.tempPassword && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 text-sm font-medium text-amber-800">
                  Nieuw tijdelijk wachtwoord (één keer zichtbaar, 24 uur geldig). Deel het zelf veilig met de gebruiker.
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    aria-label="Tijdelijk wachtwoord"
                    value={resetInfo.tempPassword}
                    onClick={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900"
                  />
                  <Button size="sm" variant="outline" onClick={handleCopy}>
                    Kopiëren
                  </Button>
                </div>
              </div>
            )}
            {resetInfo?.message && (
              <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{resetInfo.message}</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}

// Detailpaneel rechts (desktop) of als lade van onderen/rechts (mobiel). Haalt de details
// zelf op, zodat het paneel altijd de actuele serverstand toont.
export default function OrgDetailPanel({ selection, onSelect, onClose, onChanged }) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!selection) return undefined;
    let cancelled = false;
    setState({ data: null, loading: true, error: "" });
    const url = selection.kind === "user" ? `/api/admin/org/users/${selection.id}` : `/api/admin/org/companies/${selection.id}`;
    api
      .get(url)
      .then((data) => !cancelled && setState({ data, loading: false, error: "" }))
      .catch((err) =>
        !cancelled &&
        setState({ data: null, loading: false, error: err.status === 404 ? "Niet (meer) gevonden." : err.message || "Laden mislukt" })
      );
    return () => {
      cancelled = true;
    };
  }, [selection, reloadKey]);

  if (!selection) return null;

  function handleChanged(removed) {
    onChanged();
    if (removed === true) onClose();
    else setReloadKey((k) => k + 1);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" aria-hidden="true" onClick={onClose} />
      <aside
        aria-label="Details"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-xl lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:w-96 lg:max-w-none lg:shrink-0 lg:rounded-xl lg:border lg:border-slate-200 lg:shadow-sm"
      >
        <div className="flex justify-end px-3 pt-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Paneel sluiten"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <XIcon size={18} />
          </button>
        </div>
        {state.loading && <RowSkeleton rows={6} />}
        {state.error && (
          <div className="p-5">
            <InlineError message={state.error} onRetry={() => setReloadKey((k) => k + 1)} />
          </div>
        )}
        {state.data &&
          (selection.kind === "user" ? (
            <UserDetail user={state.data} onSelect={onSelect} onChanged={handleChanged} />
          ) : (
            <CompanyDetail company={state.data} onSelect={onSelect} onChanged={handleChanged} />
          ))}
        {state.data && selection.kind !== "user" && (
          <p className="px-5 pb-5 text-xs text-slate-400">
            Wijzigingen worden vastgelegd in het <Link href="/admin/audit" className="underline">auditlog</Link>.
          </p>
        )}
      </aside>
    </>
  );
}
