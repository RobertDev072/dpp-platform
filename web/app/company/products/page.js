"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

const STATUS_VARIANT = {
  draft: "neutral",
  published: "success",
  archived: "warning"
};

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");

  async function loadProducts() {
    const data = await api.get("/api/products");
    setProducts(data);
  }

  useEffect(() => {
    loadProducts().catch((err) => setError(err.message));
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      await api.post("/api/products", {
        name,
        brand: brand || undefined,
        sku: sku || undefined
      });
      setName("");
      setBrand("");
      setSku("");
      await loadProducts();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Producten</h1>

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Nieuw product</h2>
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
            Merk
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            SKU
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <Button type="submit">Aanmaken</Button>
        </form>
      </Card>

      <Card>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-3">Naam</th>
              <th className="py-2 pr-3">Merk</th>
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{product.name}</td>
                <td className="py-2 pr-3">{product.brand || "—"}</td>
                <td className="py-2 pr-3">{product.sku || "—"}</td>
                <td className="py-2 pr-3">
                  <Badge variant={STATUS_VARIANT[product.status] || "neutral"}>
                    {product.status}
                  </Badge>
                </td>
                <td className="py-2 pr-3">
                  <Link href={`/company/products/${product.id}`}>
                    <Button variant="outline">Openen</Button>
                  </Link>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  Nog geen producten.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
