import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { VeriPassoWordmark } from "@/components/landing/VeriPassoLogo";
import { documentCategoryLabel, formatFileSize } from "@/components/products/documentUtils";

// Publiek productpaspoort (bestemming van elke QR-code). Mobiel eerst: de meeste
// bezoekers scannen met hun telefoon. Server-gerenderd, zonder login en zonder
// interne gegevens (de API levert een whitelist).

async function getProduct(id) {
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");

  const response = await fetch(`${protocol}://${host}/api/public/products/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Kon productpaspoort niet laden (${response.status})`);
  return response.json();
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  try {
    const product = await getProduct(id);
    if (!product) return { title: "Productpaspoort niet gevonden" };
    return {
      title: `${product.name} – digitaal productpaspoort`,
      description: product.description?.slice(0, 160) || `Productinformatie, duurzaamheid en documenten van ${product.name}.`
    };
  } catch {
    return { title: "Digitaal productpaspoort" };
  }
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, children }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function Pill({ children, tone = "green" }) {
  const tones = { green: "bg-emerald-50 text-emerald-800 ring-emerald-200", slate: "bg-slate-100 text-slate-700 ring-slate-200" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>{children}</span>;
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m4 10.5 4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function ProductPassportPage({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  const publicDocuments = (product.documents || []).filter((doc) => doc.downloadUrl);
  const s = product.sustainability;
  const c = product.compliance;
  const materials = Array.isArray(s?.materials) ? s.materials : [];
  const regulations = Array.isArray(c?.applicable_regulations) ? c.applicable_regulations : [];

  const badges = [];
  if (c?.ce_marked) badges.push("CE-markering");
  if (s?.recyclable) badges.push("Recyclebaar");
  if (s?.reach_conform) badges.push("REACH-conform");
  if (s?.rohs_conform) badges.push("RoHS-conform");

  const facts = [
    ["Merk", product.brand],
    ["Model", product.model],
    ["Fabrikant", product.manufacturer],
    ["Land van oorsprong", product.countryOfOrigin],
    ["SKU", product.sku],
    ["GTIN / EAN", product.gtin]
  ].filter(([, value]) => value);

  const hasSustainability = s && (s.co2_footprint_kg != null || s.recycled_material_pct != null || materials.length || s.expected_lifespan_years || s.epd_url);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          {product.issuer?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.issuer.logo} alt={product.issuer.name} className="h-8 max-w-[10rem] object-contain" />
          ) : (
            <span className="truncate text-sm font-semibold text-slate-900">{product.issuer?.name || product.brand || ""}</span>
          )}
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">Digitaal productpaspoort</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5 sm:py-8">
        {product.archived && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            Dit product wordt niet meer actief aangeboden. De gegevens hieronder blijven beschikbaar als naslag.
          </p>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {product.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.photoUrl} alt={product.name} className="aspect-[4/3] w-full bg-slate-100 object-cover" />
          )}
          <div className="space-y-3 p-5">
            {product.categoryLabel && <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{product.categoryLabel}</p>}
            <h1 className="text-2xl font-bold leading-tight text-slate-900">{product.name}</h1>
            {(product.brand || product.model) && <p className="text-sm text-slate-600">{[product.brand, product.model].filter(Boolean).join(" · ")}</p>}
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {badges.map((b) => (
                  <Pill key={b}>
                    <Check />
                    {b}
                  </Pill>
                ))}
              </div>
            )}
            {product.description && <p className="whitespace-pre-line pt-1 text-[15px] leading-relaxed text-slate-700">{product.description}</p>}
            {product.highlights?.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {product.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-0.5 text-emerald-600">
                      <Check />
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {facts.length > 0 && (
          <Section title="Productinformatie">
            <dl className="grid grid-cols-2 gap-2">
              {facts.map(([label, value]) => (
                <Fact key={label} label={label}>
                  {value}
                </Fact>
              ))}
            </dl>
          </Section>
        )}

        {hasSustainability && (
          <Section title="Duurzaamheid">
            <dl className="grid grid-cols-2 gap-2">
              {s.co2_footprint_kg != null && <Fact label="CO₂-voetafdruk">{Number(s.co2_footprint_kg).toLocaleString("nl-NL")} kg CO₂-eq</Fact>}
              {s.co2_reduction_pct != null && <Fact label="CO₂-reductie">{Number(s.co2_reduction_pct).toLocaleString("nl-NL")}%</Fact>}
              {s.expected_lifespan_years != null && <Fact label="Verwachte levensduur">{s.expected_lifespan_years} jaar</Fact>}
            </dl>
            {s.recycled_material_pct != null && (
              <div className="mt-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-600">Gerecycled materiaal</span>
                  <span className="font-semibold text-slate-900">{Number(s.recycled_material_pct).toLocaleString("nl-NL")}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${s.recycled_material_pct}% gerecycled materiaal`}>
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Number(s.recycled_material_pct))}%` }} />
                </div>
              </div>
            )}
            {materials.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1.5 text-sm font-medium text-slate-700">Materialen</h3>
                <ul className="divide-y divide-slate-100 text-sm">
                  {materials.map((m, i) => (
                    <li key={i} className="flex justify-between py-1.5">
                      <span className="text-slate-700">{m.material}</span>
                      {m.pct != null && <span className="tabular-nums text-slate-500">{m.pct}%</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.epd_url && /^https?:\/\//i.test(s.epd_url) && (
              <a href={s.epd_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-block text-sm font-medium text-emerald-700 underline-offset-2 hover:underline">
                Milieuproductverklaring (EPD) bekijken
              </a>
            )}
          </Section>
        )}

        {c && (c.ce_marked || regulations.length > 0) && (
          <Section title="Compliance">
            <div className="flex flex-wrap gap-2">
              {c.ce_marked && (
                <Pill>
                  <Check /> CE-markering
                </Pill>
              )}
              {regulations.map((r) => (
                <Pill key={r} tone="slate">
                  {r}
                </Pill>
              ))}
            </div>
          </Section>
        )}

        {product.parts?.length > 0 && (
          <Section title="Onderdelen">
            <ul className="divide-y divide-slate-100 text-sm">
              {product.parts.map((part) => (
                <li key={part.id} className="flex justify-between gap-3 py-2">
                  <span className="text-slate-800">{part.name}</span>
                  {part.part_number && <span className="text-xs text-slate-500">{part.part_number}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {publicDocuments.length > 0 && (
          <Section title="Documenten">
            <ul className="space-y-2">
              {publicDocuments.map((doc) => (
                <li key={doc.id}>
                  <a href={doc.downloadUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40">
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11.5 2.5H6A1.5 1.5 0 0 0 4.5 4v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5l-4-4Z" />
                        <path d="M11.5 2.5v4h4" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{doc.title}</span>
                      <span className="block text-xs text-slate-500">
                        {[documentCategoryLabel(doc.category), doc.language?.toUpperCase(), doc.fileSize != null ? formatFileSize(doc.fileSize) : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <footer className="flex flex-col items-center gap-2 pb-6 pt-4 text-center text-xs text-slate-400">
          {product.publishedAt && <p>Gepubliceerd op {new Date(product.publishedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</p>}
          <div className="flex items-center gap-1.5">
            <span>Digitaal productpaspoort via</span>
            <VeriPassoWordmark className="h-4 w-auto" />
          </div>
        </footer>
      </main>
    </div>
  );
}
