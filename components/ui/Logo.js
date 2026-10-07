export default function Logo({ className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="28" height="28" rx="8" className="fill-emerald-600" />
        <path
          d="M9 19c0-5.5 4.5-10 10-10 0 5.5-4.5 10-10 10Z"
          fill="white"
        />
        <path
          d="M9 19c0-5.5 2-8 2-8"
          stroke="#10b981"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-semibold text-lg">DPP Platform</span>
    </div>
  );
}
