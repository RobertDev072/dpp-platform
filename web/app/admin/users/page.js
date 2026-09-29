"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  ASSIGNABLE_ROLE_OPTIONS,
  USER_STATUS_BADGE_VARIANTS,
  USER_STATUS_OPTIONS,
  fullName,
  roleLabel,
  statusLabel
} from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

export default function UsersPage() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

  const companiesById = useMemo(
    () => Object.fromEntries(companies.map((company) => [company.id, company])),
    [companies]
  );

  useEffect(() => {
    Promise.all([api.get("/api/admin/companies"), api.get("/api/users")])
      .then(([companyData, userData]) => {
        setCompanies(companyData);
        setUsers(userData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function companyName(user) {
    if (user.company_id == null) {
      return "";
    }
    return companiesById[user.company_id]?.name || `#${user.company_id}`;
  }

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return users;
    }
    return users.filter((user) => {
      const haystack = [user.email, fullName(user), companyName(user)].join(" ").toLowerCase();
      return haystack.includes(term);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, search, companiesById]);

  async function patchUser(user, body) {
    const previous = users;
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...body } : u)));
    try {
      const updated = await api.patch(`/api/users/${user.id}`, body);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
    } catch (err) {
      setUsers(previous);
      // O.a. 409 LAST_COMPANY_ADMIN: de server legt in het Nederlands uit waarom het niet mag.
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Gebruikers</h1>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      <Card className="border-blue-200 bg-blue-50 text-blue-800">
        <p className="text-sm">
          Nieuwe gebruikers worden hier niet aangemaakt. Company Admins nodig je uit via de{" "}
          <Link href="/admin/companies" className="font-medium underline hover:no-underline">
            bedrijvenpagina
          </Link>
          ; medewerkers worden aangemaakt door hun eigen Company Admin.
        </p>
      </Card>

      <Card>
        <label htmlFor="user-search" className="block text-sm font-medium text-slate-700">
          Zoeken
        </label>
        <input
          id="user-search"
          type="search"
          placeholder="Zoek op e-mail, naam of bedrijf"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1 block w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />

        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              title={search ? "Geen gebruikers gevonden" : "Nog geen gebruikers"}
              description={
                search
                  ? "Probeer een andere zoekterm."
                  : "Zodra bedrijven gebruikers hebben, verschijnen ze hier."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">E-mail</th>
                    <th className="py-2 pr-3">Naam</th>
                    <th className="py-2 pr-3">Bedrijf</th>
                    <th className="py-2 pr-3">Rol</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Status wijzigen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const isPlatformOwner = user.role === "platform_owner";
                    return (
                      <tr key={user.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3">{user.email}</td>
                        <td className="py-2 pr-3">{fullName(user) || "—"}</td>
                        <td className="py-2 pr-3">{companyName(user) || "—"}</td>
                        <td className="py-2 pr-3">
                          {isPlatformOwner ? (
                            roleLabel(user.role)
                          ) : (
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
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant={USER_STATUS_BADGE_VARIANTS[user.status] || "neutral"}>
                            {statusLabel(user.status)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          {isPlatformOwner ? (
                            <span className="text-xs text-slate-400">Niet wijzigbaar</span>
                          ) : (
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
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
