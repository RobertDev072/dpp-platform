import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import Logo from "@/components/ui/Logo";
import { documentCategoryLabel, formatFileSize } from "@/components/products/documentUtils";
import { getPublicPassport, isReservedQr } from "@/src/services/publicPassport.service";
import requestMetrics from "@/src/monitoring/requestMetrics";
import { maybeFlush } from "@/src/monitoring/flush";

// Bestemming van elke QR-code ({QR_BASE_URL}/p/{public_id}). Altijd vers renderen:
// het paspoort kan elk moment worden bijgewerkt en elke weergave telt als scan.
export const dynamic = "force-dynamic";

export const metadata = { title: "Digitaal productpaspoort", robots: { index: false, follow: false } };

// Rechtstreeks de service aanroepen (niet via een HTTP-call naar onze eigen API):
// op Vercel scheelt dat per QR-scan een tweede function-aanroep.
async function getProduct(id) {
  const headersList = await headers();
  const start = process.hrtime.bigint();
  let status = 200;
  try {
    const passport = await getPublicPassport(id, {
      userAgent: headersList.get("user-agent"),
      referrer: headersList.get("referer"),
      // Scanregistratie afmaken nadat de pagina al naar de bezoeker is gestuurd.
      onScanRecorded: (pending) => after(() => pending)
    });
    if (!passport) status = 404;
    return passport;
  } catch (error) {
    status = 500;
    throw error;
  } finally {
    // Telemetrie voor de "publiek"-scope op het monitoringdashboard.
    requestMetrics.record({
      scope: "public",
      method: "GET",
      path: `/p/${id}`,
      status,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6
    });
    after(() => maybeFlush());
  }
}

function Section({ title, icon, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Pill({ ok, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
        ok ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
      }`}
    >
      <span aria-hidden="true">{ok ? "✓" : "–"}</span>
      {children}
    </span>
  );
}

const Icon = {
  leaf: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16c0-7 5-11 12-12-1 7-5 12-12 12Z" />
      <path d="M4 16 11 9" />
    </svg>
  ),
  shield: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5 16 5v5c0 4-2.7 6.5-6 7.5-3.3-1-6-3.5-6-7.5V5l6-2.5Z" />
      <path d="m7.5 10 1.8 1.8L12.8 8" />
    </svg>
  ),
  file: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5H6A1.5 1.5 0 0 0 4.5 4v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5l-4-4Z" />
      <path d="M11.5 2.5v4h4" />
    </svg>
  ),
  parts: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5Z" />
      <path d="m3 6 7 3.5L17 6M10 9.5v8" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v5M10 6.5v.01" />
    </svg>
  )
};

function NotPublished() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo />
      <h1 className="text-xl font-semibold text-slate-900">Dit productpaspoort is nog niet gepubliceerd</h1>
      <p className="text-sm text-slate-600">
        De QR-code is geldig, maar de fabrikant heeft de productinformatie nog niet vrijgegeven.
        Probeer het later opnieuw.
      </p>
    </main>
  );
}

export default async function ProductPassportPage({ params }) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) {
    if (await isReservedQr(id)) return <NotPublished />;
    notFound();
  }

  // Alleen documenten met een downloadlink tonen; rijen zonder downloadUrl zijn
  // op het publieke paspoort niet te openen.
  const publicDocuments = (product.documents || []).filter((doc) => doc.downloadUrl);
  const s = product.sustainability;
  const c = product.compliance;
  const hasSustainability =
    s && (s.co2_footprint_kg != null || s.recycled_material_pct != null || s.recyclable != null ||
      s.reach_conform != null || s.rohs_conform != null || s.expected_lifespan_years != null || s.materials?.length);
  const hasCompliance = c && (c.ce_marked != null || c.applicable_regulations?.length);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {product.companyLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.companyLogo} alt="" className="h-8 w-8 shrink-0 rounded object-contain" />
            ) : null}
            <span className="truncate text-sm font-semibold text-slate-800">
              {product.brand || product.companyName || "Productpaspoort"}
            </span>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            Digitaal productpaspoort
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5 sm:py-8">
        {product.archived && (
          <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Dit product wordt niet meer geproduceerd. De gegevens blijven beschikbaar als naslag.
          </p>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {product.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.photoUrl} alt={product.name} className="aspect-[4/3] w-full bg-slate-100 object-cover" />
          )}
          <div className="space-y-3 p-5">
            {product.categoryLabel && (
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{product.categoryLabel}</p>
            )}
            <h1 className="text-2xl font-bold leading-tight text-slate-900">{product.name}</h1>
            {(product.brand || product.model) && (
              <p className="text-sm text-slate-600">{[product.brand, product.model].filter(Boolean).join(" · ")}</p>
            )}
            {product.description && <p className="text-[15px] leading-relaxed text-slate-700">{product.description}</p>}
            {product.highlights?.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {product.highlights.map((highlight, index) => (
                  <li key={index} className="flex gap-2 text-sm text-slate-700">
                    <span aria-hidden="true" className="text-emerald-600">✓</span>
                    {highlight}
                  </li>
                ))}
              </ul>
            )}
            {(c?.ce_marked || s?.recyclable) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {c?.ce_marked && <Pill ok>CE-markering</Pill>}
                {s?.recyclable && <Pill ok>Recyclebaar</Pill>}
              </div>
            )}
          </div>
        </section>

        <Section title="Productgegevens" icon={Icon.info}>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Fact label="Fabrikant" value={product.manufacturer} />
            <Fact label="Land van oorsprong" value={product.countryOfOrigin} />
            <Fact label="Artikelnummer (SKU)" value={product.sku} />
            <Fact label="GTIN / EAN" value={product.gtin} />
          </dl>
        </Section>

        {hasSustainability && (
          <Section title="Duurzaamheid" icon={Icon.leaf}>
            <dl className="grid grid-cols-2 gap-2">
              <Fact label="CO₂-voetafdruk" value={s.co2_footprint_kg != null ? `${s.co2_footprint_kg.toLocaleString("nl-NL")} kg` : null} />
              <Fact label="Gerecycled materiaal" value={s.recycled_material_pct != null ? `${s.recycled_material_pct.toLocaleString("nl-NL")}%` : null} />
              <Fact label="Verwachte levensduur" value={s.expected_lifespan_years != null ? `${s.expected_lifespan_years} jaar` : null} />
              <Fact label="Materialen" value={s.materials?.length ? s.materials.map((m) => m.material).join(", ") : null} />
            </dl>
            {s.recycled_material_pct != null && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, s.recycled_material_pct)}%` }} />
                </div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {s.recyclable != null && <Pill ok={s.recyclable}>Recyclebaar</Pill>}
              {s.reach_conform != null && <Pill ok={s.reach_conform}>REACH-conform</Pill>}
              {s.rohs_conform != null && <Pill ok={s.rohs_conform}>RoHS-conform</Pill>}
            </div>
          </Section>
        )}

        {hasCompliance && (
          <Section title="Compliance" icon={Icon.shield}>
            <div className="flex flex-wrap gap-2">
              {c.ce_marked != null && <Pill ok={c.ce_marked}>CE-markering</Pill>}
              {(c.applicable_regulations || []).map((reg) => (
                <span key={reg} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-200">
                  {reg}
                </span>
              ))}
            </div>
          </Section>
        )}

        {product.parts?.length > 0 && (
          <Section title="Onderdelen" icon={Icon.parts}>
            <ul className="divide-y divide-slate-100">
              {product.parts.map((part) => (
                <li key={part.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-800">{part.name}</span>
                  {part.part_number && <span className="shrink-0 text-xs text-slate-500">{part.part_number}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {publicDocuments.length > 0 && (
          <Section title="Documenten" icon={Icon.file}>
            <ul className="space-y-2">
              {publicDocuments.map((doc) => {
                const meta = [documentCategoryLabel(doc.category), doc.fileSize != null ? formatFileSize(doc.fileSize) : ""]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={doc.id}>
                    <a
                      href={doc.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{doc.title}</span>
                        {meta && <span className="block text-xs text-slate-500">{meta}</span>}
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-emerald-700">↗</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <footer className="flex flex-col items-center gap-2 pb-6 pt-4 text-center text-xs text-slate-400">
          <Logo />
          <p>
            Digitaal productpaspoort
            {product.publishedAt ? ` · gepubliceerd ${new Date(product.publishedAt).toLocaleDateString("nl-NL")}` : ""}
          </p>
        </footer>
      </main>
    </div>
  );
}
