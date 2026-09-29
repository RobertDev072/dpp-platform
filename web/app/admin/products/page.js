"use client";

import ProductsTable from "@/components/ProductsTable";
import ProductsPageHeader from "@/components/products/ProductsPageHeader";

export default function AdminProductsPage() {
  return (
    <div className="space-y-6">
      <ProductsPageHeader />
      <ProductsTable readOnly showCompanyFilter showStats />
    </div>
  );
}
