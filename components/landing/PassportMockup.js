import LoginDemoCard from "./LoginDemoCard";
import { VeriPassoIcon } from "./VeriPassoLogo";

const FIELDS = [
  { label: "PRODUCT", value: "[PRODUCTNAAM]" },
  { label: "FABRIKANT", value: "[UW BEDRIJF]" },
  { label: "HERKOMST", value: "[LAND]" },
  { label: "MATERIALEN", value: "[MATERIALEN]" },
  { label: "CO2", value: "[WAARDE]" },
  { label: "RECYCLEBAAR", value: "Ja" }
];

const PRODUCT_DATA_ITEMS = ["Productdata", "Materialen", "Certificaten", "Duurzaamheid", "Traceerbaarheid"];

const FLOATING_BADGES = ["Geverifieerd", "Transparante keten", "Circulair", "Compliance ready"];

const QR_PATTERN = [
  1, 1, 1, 0, 1, 0, 1, 1,
  1, 0, 1, 0, 0, 1, 0, 1,
  1, 1, 1, 0, 1, 1, 0, 1,
  0, 0, 0, 0, 0, 1, 1, 0,
  1, 0, 1, 1, 0, 0, 1, 1,
  0, 1, 0, 1, 1, 0, 1, 0,
  1, 0, 1, 0, 1, 1, 0, 1,
  1, 1, 0, 1, 0, 1, 1, 0
];

export default function PassportMockup() {
  return (
    <div className="relative mx-auto h-[480px] w-full max-w-md">
      <div className="absolute left-0 top-2 hidden w-40 rounded-xl border border-slate-200 bg-white p-3 shadow-lg sm:block">
        <p className="mb-2 text-[10px] font-semibold tracking-wide text-slate-400">PRODUCTDATA</p>
        <ul className="space-y-1.5">
          {PRODUCT_DATA_ITEMS.map((item) => (
            <li
              key={item}
              className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="absolute right-0 top-0 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#06162A] p-4 text-white shadow-2xl sm:right-4">
        <div className="mb-3 flex items-center gap-1.5">
          <VeriPassoIcon className="h-4 w-4" />
          <div>
            <p className="text-[11px] font-semibold leading-none">VeriPasso</p>
            <p className="mt-0.5 text-[9px] leading-none text-slate-400">DIGITAL PRODUCT PASSPORT</p>
          </div>
        </div>

        <p className="mb-2 text-[9px] tracking-wide text-slate-500">VP-0001 PRODUCTPASPOORT</p>

        <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {FIELDS.map((field) => (
            <div key={field.label}>
              <dt className="text-[8px] tracking-wide text-slate-500">{field.label}</dt>
              <dd className="truncate text-[10px] text-slate-100">{field.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="grid grid-cols-8 gap-[1px] rounded-md bg-white p-1.5">
            {QR_PATTERN.map((filled, index) => (
              <span
                key={index}
                className={`h-[3px] w-[3px] ${filled ? "bg-slate-900" : "bg-white"}`}
              />
            ))}
          </div>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-medium text-emerald-400">
            Geverifieerd
          </span>
        </div>

        <p className="mt-2 truncate text-[7px] tracking-widest text-slate-600">
          P&lt;VERIPASSO&lt;&lt;VP0001 ESPR&lt;&lt;EU
        </p>
      </div>

      <div className="absolute right-0 top-[190px] hidden flex-col gap-2 sm:flex">
        {FLOATING_BADGES.map((badge, index) => (
          <span
            key={badge}
            className="animate-float-slow rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 shadow-md"
            style={{ animationDelay: `${index * 0.4}s` }}
          >
            {badge}
          </span>
        ))}
      </div>

      <LoginDemoCard className="absolute bottom-0 left-2 animate-float-slow" />
    </div>
  );
}
