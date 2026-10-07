const VARIANT_CLASSES = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-slate-600 text-white hover:bg-slate-700",
  outline: "border border-slate-300 text-slate-700 hover:bg-slate-50"
};

export default function Button({ variant = "primary", className = "", ...props }) {
  const classes = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;

  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${classes} ${className}`}
      {...props}
    />
  );
}
