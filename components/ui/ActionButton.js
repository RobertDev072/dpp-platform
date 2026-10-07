import Link from "next/link";

// Eén knopstijl voor alle pagina-acties (+ Product, Importeren, Exporteren, ...).
// variant: primary (hoofdactie, max. één per pagina), secondary, ghost, danger.
const VARIANTS = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 border border-transparent",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400",
  ghost: "border border-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-500"
};

export default function ActionButton({ href, variant = "secondary", icon, children, className = "", size = "md", ...props }) {
  const sizing = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  const classes = `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant] || VARIANTS.secondary} ${className}`;
  const content = (
    <>
      {icon && <span aria-hidden="true" className="-ml-0.5 shrink-0">{icon}</span>}
      {children}
    </>
  );
  // Downloads, API-bestanden en nieuwe tabbladen zijn geen app-pagina's: gewone <a>.
  if (href && (props.download !== undefined || props.target || href.startsWith("/api/") || href.startsWith("http"))) {
    return (
      <a href={href} className={classes} {...props}>
        {content}
      </a>
    );
  }
  if (href) {
    return (
      <Link href={href} className={classes} {...props}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...props}>
      {content}
    </button>
  );
}
