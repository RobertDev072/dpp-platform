import { redirect } from "next/navigation";

// Detail van een import = de wizard op die job (toont status, resultaat of hervatten).
export default async function ImportDetailPage({ params }) {
  const { id } = await params;
  redirect(`/company/products/import?id=${encodeURIComponent(id)}`);
}
