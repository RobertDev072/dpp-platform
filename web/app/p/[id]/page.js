import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Logo from "@/components/ui/Logo";
import { documentCategoryLabel, formatFileSize } from "@/components/products/documentUtils";

async function getProduct(id) {
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");

  const response = await fetch(`${protocol}://${host}/api/public/products/${id}`, {
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Kon productpaspoort niet laden (${response.status})`);
  }

  return response.json();
}

export default async function ProductPassportPage({ params }) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) {
    notFound();
  }

  // Alleen documenten met een downloadlink tonen; rijen zonder downloadUrl zijn
  // op het publieke paspoort niet te openen.
  const publicDocuments = (product.documents || []).filter((doc) => doc.downloadUrl);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <Logo />

      <Card className="space-y-2">
        {product.archived && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            Dit product is gearchiveerd. De onderstaande gegevens blijven beschikbaar als
            naslag, maar worden niet meer actief bijgewerkt.
          </p>
        )}
        {product.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.photoUrl}
            alt={product.name}
            className="mb-2 max-h-80 w-full rounded-lg object-cover"
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{product.name}</h1>
          {product.categoryLabel && <Badge variant="info">{product.categoryLabel}</Badge>}
        </div>
        <p className="text-sm text-slate-600">
          {[product.brand, product.model].filter(Boolean).join(" — ")}
        </p>
        {product.description && <p className="text-sm text-slate-700">{product.description}</p>}
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {product.sku && (
            <div>
              <dt className="text-slate-500">SKU</dt>
              <dd className="text-slate-900">{product.sku}</dd>
            </div>
          )}
          {product.gtin && (
            <div>
              <dt className="text-slate-500">GTIN</dt>
              <dd className="text-slate-900">{product.gtin}</dd>
            </div>
          )}
          {product.manufacturer && (
            <div>
              <dt className="text-slate-500">Fabrikant</dt>
              <dd className="text-slate-900">{product.manufacturer}</dd>
            </div>
          )}
          {product.countryOfOrigin && (
            <div>
              <dt className="text-slate-500">Land van herkomst</dt>
              <dd className="text-slate-900">{product.countryOfOrigin}</dd>
            </div>
          )}
        </dl>
        {product.highlights?.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {product.highlights.map((highlight, index) => (
              <li key={index}>{highlight}</li>
            ))}
          </ul>
        )}
      </Card>

      {product.sustainability && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Duurzaamheid</h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {product.sustainability.co2_footprint_kg != null && (
              <div>
                <dt className="text-slate-500">CO2-voetafdruk</dt>
                <dd className="text-slate-900">{product.sustainability.co2_footprint_kg} kg</dd>
              </div>
            )}
            {product.sustainability.recycled_material_pct != null && (
              <div>
                <dt className="text-slate-500">Gerecycled materiaal</dt>
                <dd className="text-slate-900">
                  {product.sustainability.recycled_material_pct}%
                </dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-2 pt-2">
            {product.sustainability.recyclable && <Badge variant="success">Recyclebaar</Badge>}
            {product.sustainability.reach_conform && <Badge variant="success">REACH-conform</Badge>}
            {product.sustainability.rohs_conform && <Badge variant="success">RoHS-conform</Badge>}
          </div>
        </Card>
      )}

      {product.compliance && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Compliance</h2>
          <div className="flex flex-wrap gap-2">
            {product.compliance.ce_marked && <Badge variant="success">CE-gemarkeerd</Badge>}
            {(product.compliance.applicable_regulations || []).map((reg) => (
              <Badge key={reg} variant="neutral">
                {reg}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {product.parts?.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Onderdelen</h2>
          <ul className="space-y-1 text-sm text-slate-700">
            {product.parts.map((part) => (
              <li key={part.id}>{part.name}</li>
            ))}
          </ul>
        </Card>
      )}

      {publicDocuments.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Documenten</h2>
          <ul className="space-y-1 text-sm">
            {publicDocuments.map((doc) => {
              const meta = [
                documentCategoryLabel(doc.category),
                doc.fileSize != null ? formatFileSize(doc.fileSize) : ""
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <li key={doc.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="text-blue-600">
                    {doc.title}
                  </a>
                  {meta && <span className="text-xs text-slate-500">{meta}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
