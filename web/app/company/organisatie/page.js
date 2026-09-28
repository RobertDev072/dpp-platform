"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const ROLE_OPTIONS = [
  { value: "company_admin", label: "Company Admin" },
  { value: "company_user", label: "Medewerker" },
  { value: "viewer", label: "Viewer" }
];

export default function OrganisatiePage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("company_user");

  async function loadUsers() {
    const data = await api.get("/api/users");
    setUsers(data);
  }

  useEffect(() => {
    loadUsers().catch((err) => setError(err.message));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      await api.post("/api/users", {
        email,
        password: password || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        role
      });
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStatusChange(user, value) {
    try {
      await api.patch(`/api/users/${user.id}`, { status: value });
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Organisatie</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
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
          <Button type="submit">Aanmaken</Button>
        </form>
      </Card>

      <Card>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-3">E-mail</th>
              <th className="py-2 pr-3">Naam</th>
              <th className="py-2 pr-3">Rol</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{user.email}</td>
                <td className="py-2 pr-3">
                  {[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
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
