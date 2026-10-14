import { notFound } from "next/navigation";

// Alleen numerieke product-id's: oude paden zoals /company/products/import (importeren is
// verwijderd) geven een echte 404 in plaats van een lege productpagina.
export default async function ProductIdLayout({ children, params }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(String(id))) notFound();
  return children;
}
