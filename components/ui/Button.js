import Link from "next/link";

const VARIANT_CLASSES = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-slate-600 text-white hover:bg-slate-700",
  outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  // Primaire actie in de nieuwe paginakoppen (+ Product, Importeren afronden, ...).
  accent: "bg-emerald-600 text-white hover:bg-emerald-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
};

const SIZE_CLASSES = {
  md: "px-4 py-2 text-sm",
  sm: "px-2.5 py-1.5 text-xs"
};

function classesFor(variant, size, className) {
  const variantClasses = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const sizeClasses = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  return `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses} ${sizeClasses} ${className}`;
}

export default function Button({ variant = "primary", size = "md", icon: IconComponent, loading = false, className = "", children, disabled, type = "button", ...props }) {
  return (
    <button type={type} className={classesFor(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading ? (
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        IconComponent && <IconComponent size={size === "sm" ? 14 : 16} />
      )}
      {children}
    </button>
  );
}

// Zelfde opmaak als Button, maar als (interne of download-)link.
export function ButtonLink({ variant = "outline", size = "md", icon: IconComponent, className = "", children, href, external = false, ...props }) {
  const classes = classesFor(variant, size, className);
  const content = (
    <>
      {IconComponent && <IconComponent size={size === "sm" ? 14 : 16} />}
      {children}
    </>
  );
  if (external || props.download !== undefined || href.startsWith("/api/")) {
    return (
      <a href={href} className={classes} {...props}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...props}>
      {content}
    </Link>
  );
}
