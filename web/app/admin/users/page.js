"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const ROLE_OPTIONS = [
  { value: "company_admin", label: "Company Admin" },
  { value: "company_user", label: "Productmedewerker" }
];

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("company_user");
  const [companyId, setCompanyId] = useState("");

  const companiesById = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c])),
    [companies]
  );

  async function loadUsers() {
    const data = await api.get("/api/users");
    setUsers(data);
  }

  async function loadCompanies() {
    const data = await api.get("/api/admin/companies");
    setCompanies(data);
    if (data.length > 0) {
      setCompanyId((current) => current || String(data[0].id));
    }
  }

  useEffect(() => {
    Promise.all([loadCompanies(), loadUsers()]).catch((err) => setError(err.message));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    setError("");
    setTempPassword(null);
    setCreating(true);
    try {
      const body = {
        email,
        password: password || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        role
      };

      body.companyId = companyId ? Number(companyId) : undefined;

      const created = await api.post("/api/users", body);
      // De nieuwe gebruiker direct in de lijst tonen i.p.v. alles opnieuw op te halen.
      setUsers((prev) => [...prev, created].sort((a, b) => a.email.localeCompare(b.email)));

      // Bij Entra-provisioning stuurt de API eenmalig een tijdelijk wachtwoord mee - dat
      // wordt nooit opgeslagen en moet dus nu getoond worden, anders is het weg.
      if (created.tempPassword) {
        setTempPassword({ email: created.email, value: created.tempPassword });
      }

      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(user, value) {
    const previous = users;
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: value } : u)));
    try {
      await api.patch(`/api/users/${user.id}`, { status: value });
    } catch (err) {
      setUsers(previous);
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Gebruikers</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      {tempPassword && (
        <Card className="border-amber-200 bg-amber-50 text-amber-800">
          <p className="mb-2 text-sm font-medium">
            Tijdelijk wachtwoord voor {tempPassword.email} (wordt maar één keer getoond,
            deel dit zelf veilig met de gebruiker):
          </p>
          <input
            readOnly
            value={tempPassword.value}
            onClick={(e) => e.target.select()}
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuwe gebruiker</h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
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
            Wachtwoord
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="alleen zonder Entra"
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
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Rol
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Bedrijf
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
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
              <th className="py-2 pr-3">E-mail</th>
              <th className="py-2 pr-3">Bedrijf</th>
              <th className="py-2 pr-3">Rol</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{user.id}</td>
                <td className="py-2 pr-3">{user.email}</td>
                <td className="py-2 pr-3">
                  {user.company_id ? companiesById[user.company_id]?.name || `#${user.company_id}` : "—"}
                </td>
                <td className="py-2 pr-3">{user.role}</td>
                <td className="py-2 pr-3">
                  <select
                    value={user.status}
                    onChange={(e) => handleStatusChange(user, e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
