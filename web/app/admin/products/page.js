"use client";

import ProductsTable from "@/components/ProductsTable";

export default function AdminProductsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Producten (alle bedrijven)</h1>
      <ProductsTable readOnly showCompanyFilter />
    </div>
  );
}
