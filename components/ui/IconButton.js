// Compacte icoonknop voor actie-rijen in tabellen. De tooltip komt via het
// native title-attribuut; aria-label krijgt dezelfde tekst voor screenreaders.

const TONE_CLASSES = {
  default:
    "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-slate-400",
  primary:
    "border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-blue-500",
  danger:
    "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-500"
};

export default function IconButton({
  title,
  onClick,
  tone = "default",
  disabled = false,
  children,
  className = "",
  ...props
}) {
  const toneClasses = TONE_CLASSES[tone] || TONE_CLASSES.default;

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border p-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// Gedeelde 18px stroke-iconen zodat beide gebruikerspagina's dezelfde set gebruiken.
function Svg({ children }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// "Inloggen als": pijl een deur/bracket in.
export function LoginIcon() {
  return (
    <Svg>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </Svg>
  );
}

// "Reset wachtwoord": sleutel.
export function KeyIcon() {
  return (
    <Svg>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L13 6" />
    </Svg>
  );
}

// "Beheren": tandwiel.
export function CogIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}

// "Verwijderen" (alleen platform owner): prullenbak.
export function TrashIcon() {
  return (
    <Svg>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Svg>
  );
}

// "Archiveren": archiefdoos.
export function ArchiveIcon() {
  return (
    <Svg>
      <path d="M21 8v13H3V8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <path d="M10 12h4" />
    </Svg>
  );
}

// "Herstellen": pijl terug (rotate-ccw).
export function RestoreIcon() {
  return (
    <Svg>
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </Svg>
  );
}
