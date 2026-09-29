const VARIANT_CLASSES = {
  success: "bg-emerald-100 text-emerald-700",
  info: "bg-blue-100 text-blue-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  neutral: "bg-slate-100 text-slate-600"
};

export default function Badge({ variant = "neutral", children }) {
  const classes = VARIANT_CLASSES[variant] || VARIANT_CLASSES.neutral;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  );
}
