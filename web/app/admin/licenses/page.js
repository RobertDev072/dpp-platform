"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

export default function LicensesPage() {
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxProducts, setMaxProducts] = useState("");

  async function loadPlans() {
    const data = await api.get("/api/admin/plans");
    setPlans(data);
  }

  useEffect(() => {
    loadPlans().catch((err) => setError(err.message));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      await api.post("/api/admin/plans", {
        name,
        maxUsers: Number(maxUsers),
        maxProducts: Number(maxProducts)
      });
      setName("");
      setMaxUsers("");
      setMaxProducts("");
      await loadPlans();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Licenties</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuw plan</h2>
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
            Max. gebruikers
            <input
              type="number"
              min="0"
              value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Max. producten
            <input
              type="number"
              min="0"
              value={maxProducts}
              onChange={(e) => setMaxProducts(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <Button type="submit">Aanmaken</Button>
        </form>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3">ID</th>
                <th className="py-2 pr-3">Naam</th>
                <th className="py-2 pr-3">Max. gebruikers</th>
                <th className="py-2 pr-3">Max. producten</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{plan.id}</td>
                  <td className="py-2 pr-3">{plan.name}</td>
                  <td className="py-2 pr-3">{plan.max_users}</td>
                  <td className="py-2 pr-3">{plan.max_products}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
