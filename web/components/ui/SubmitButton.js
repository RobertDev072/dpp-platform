"use client";

export default function SubmitButton({ loading = false, disabled, children, className = "", ...props }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 ${className}`}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
        />
      )}
      {loading ? "Bezig..." : children}
    </button>
  );
}
