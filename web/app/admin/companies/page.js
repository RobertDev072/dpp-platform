"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const STATUS_OPTIONS = ["active", "suspended", "archived"];

function insertSorted(list, company) {
  const next = [...list.filter((c) => c.id !== company.id), company];
  next.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState([]);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [invitePanelCompany, setInvitePanelCompany] = useState(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [planId, setPlanId] = useState("");

  async function loadCompanies() {
    const data = await api.get("/api/admin/companies");
    setCompanies(data);
  }

  async function loadPlans() {
    const data = await api.get("/api/admin/plans");
    setPlans(data);
  }

  useEffect(() => {
    Promise.all([loadPlans(), loadCompanies()]).catch((err) => setError(err.message));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      const created = await api.post("/api/admin/companies", {
        name,
        slug,
        planId: planId ? Number(planId) : undefined
      });
      // Voeg de nieuwe rij direct toe in plaats van de hele lijst opnieuw op te halen -
      // scheelt een round-trip en voelt meteen aan.
      setCompanies((prev) => insertSorted(prev, created));
      setName("");
      setSlug("");
      setPlanId("");
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handlePlanChange(company, value) {
    const planIdValue = value ? Number(value) : null;
    const previous = companies;
    // Optimistisch bijwerken: de select reageert meteen, de PATCH volgt op de achtergrond.
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, plan_id: planIdValue } : c)));
    try {
      await api.patch(`/api/admin/companies/${company.id}`, { planId: planIdValue });
    } catch (err) {
      setCompanies(previous);
      setError(err.message);
    }
  }

  async function handleStatusChange(company, value) {
    const previous = companies;
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, status: value } : c)));
    try {
      await api.patch(`/api/admin/companies/${company.id}`, { status: value });
    } catch (err) {
      setCompanies(previous);
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Bedrijven</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuw bedrijf</h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Naam
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Slug
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Plan
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">— geen plan —</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={creating}>
            {creating ? "Bezig..." : "Aanmaken"}
          </Button>
        </form>
      </Card>

      <Card>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-3">ID</th>
              <th className="py-2 pr-3">Naam</th>
              <th className="py-2 pr-3">Slug</th>
              <th className="py-2 pr-3">Plan</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{company.id}</td>
                <td className="py-2 pr-3">{company.name}</td>
                <td className="py-2 pr-3">{company.slug}</td>
                <td className="py-2 pr-3">
                  <select
                    value={company.plan_id ?? ""}
                    onChange={(e) => handlePlanChange(company, e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">— geen plan —</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={company.status}
                    onChange={(e) => handleStatusChange(company, e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInvitePanelCompany(
                        invitePanelCompany && invitePanelCompany.id === company.id ? null : company
                      )
                    }
                  >
                    Company Admin uitnodigen
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {invitePanelCompany && (
        <InvitePanel company={invitePanelCompany} onError={setError} />
      )}
    </div>
  );
}

function InvitePanel({ company, onError }) {
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [activationUrl, setActivationUrl] = useState("");
  const [inviting, setInviting] = useState(false);

  async function loadInvites() {
    const data = await api.get(`/api/admin/companies/${company.id}/invites`);
    setInvites(data);
  }

  useEffect(() => {
    loadInvites().catch((err) => onError(err.message));
    setActivationUrl("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id]);

  async function handleInvite(event) {
    event.preventDefault();
    setInviting(true);
    try {
      const result = await api.post(`/api/admin/companies/${company.id}/invites`, {
        email,
        firstName: firstName || undefined,
        lastName: lastName || undefined
      });
      setEmail("");
      setFirstName("");
      setLastName("");
      setActivationUrl(result.activationUrl);
      // De invite zelf kennen we al uit het antwoord - direct tonen i.p.v. herladen.
      setInvites((prev) => [
        { id: result.id, email: result.email, status: result.status, expires_at: result.expires_at },
        ...prev
      ]);
    } catch (err) {
      onError(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(inviteId) {
    const previous = invites;
    setInvites((prev) => prev.map((i) => (i.id === inviteId ? { ...i, status: "revoked" } : i)));
    try {
      await api.post(`/api/admin/companies/${company.id}/invites/${inviteId}/revoke`);
    } catch (err) {
      setInvites(previous);
      onError(err.message);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-slate-900">
        Company Admin uitnodigen — {company.name}
      </h2>

      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Voornaam
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Achternaam
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        <Button type="submit" disabled={inviting}>
          {inviting ? "Bezig..." : "Uitnodiging aanmaken"}
        </Button>
      </form>

      {activationUrl && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            Activatielink (wordt maar één keer getoond, deel deze zelf met de Company Admin):
          </p>
          <input
            readOnly
            value={activationUrl}
            onClick={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
          />
        </div>
      )}

      <div className="mt-4">
        {invites.length === 0 ? (
          <p className="text-sm text-slate-500">Nog geen uitnodigingen.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3">E-mail</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Verloopt</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{invite.email}</td>
                  <td className="py-2 pr-3">{invite.status}</td>
                  <td className="py-2 pr-3">
                    {new Date(invite.expires_at).toLocaleString("nl-NL")}
                  </td>
                  <td className="py-2 pr-3">
                    {invite.status === "pending" && (
                      <Button variant="outline" onClick={() => handleRevoke(invite.id)}>
                        Intrekken
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
