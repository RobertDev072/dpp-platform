"use client";

export default function Field({ label, name, required = false, error, help, className = "", ...inputProps }) {
  const errorId = `${name}-error`;
  const helpId = `${name}-help`;

  return (
    <div className={className}>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : help ? helpId : undefined}
        className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 ${
          error ? "border-red-500" : "border-slate-300"
        }`}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="mt-1 text-xs text-slate-400">
          {help}
        </p>
      ) : null}
    </div>
  );
}
