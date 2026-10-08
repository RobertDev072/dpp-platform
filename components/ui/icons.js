// Eén set 20px stroke-iconen voor knoppen, KPI's en meldingen (zelfde stijl als de
// navigatie-iconen in AppShell). Altijd decoratief (aria-hidden): de knop of het
// label eromheen draagt de tekst of aria-label.

function Icon({ children, size = 18, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

const make = (paths) =>
  function NamedIcon(props) {
    return <Icon {...props}>{paths}</Icon>;
  };

export const PlusIcon = make(<path d="M10 4v12M4 10h12" />);
export const UploadIcon = make(
  <>
    <path d="M10 13V3.5M6 7l4-4 4 4" />
    <path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" />
  </>
);
export const DownloadIcon = make(
  <>
    <path d="M10 3.5V13M6 9.5l4 4 4-4" />
    <path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" />
  </>
);
export const EyeIcon = make(
  <>
    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
    <circle cx="10" cy="10" r="2.5" />
  </>
);
export const EditIcon = make(
  <>
    <path d="M13.5 3.5a1.8 1.8 0 0 1 2.5 2.5L7 15l-3.5 1 1-3.5 9-9Z" />
  </>
);
export const CopyIcon = make(
  <>
    <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
    <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" />
  </>
);
export const TrashIcon = make(
  <>
    <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    <path d="M5 5.5l.8 10.1a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L15 5.5M8.5 9v5M11.5 9v5" />
  </>
);
export const ArchiveIcon = make(
  <>
    <rect x="2.5" y="3.5" width="15" height="4" rx="1" />
    <path d="M4 7.5v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8M8 11h4" />
  </>
);
export const QrIcon = make(
  <>
    <rect x="3" y="3" width="5" height="5" rx="1" />
    <rect x="12" y="3" width="5" height="5" rx="1" />
    <rect x="3" y="12" width="5" height="5" rx="1" />
    <path d="M12 12h2.5v2.5H12zM17 12v2.5M14.5 17H12M17 17h.01" />
  </>
);
export const PrinterIcon = make(
  <>
    <path d="M5.5 7.5V3h9v4.5" />
    <rect x="2.5" y="7.5" width="15" height="6.5" rx="1.5" />
    <path d="M5.5 12h9v5h-9z" />
  </>
);
export const LinkIcon = make(
  <>
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" />
    <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />
  </>
);
export const ExternalIcon = make(
  <>
    <path d="M11 3.5h5.5V9M16.5 3.5 9 11" />
    <path d="M14 11.5v4a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
  </>
);
export const CheckIcon = make(<path d="m4 10.5 4 4 8-9" />);
export const CheckCircleIcon = make(
  <>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m6.8 10.3 2.2 2.2 4.2-4.6" />
  </>
);
export const AlertIcon = make(
  <>
    <path d="M8.6 3.6 2.5 14.3A1.6 1.6 0 0 0 3.9 16.7h12.2a1.6 1.6 0 0 0 1.4-2.4L11.4 3.6a1.6 1.6 0 0 0-2.8 0Z" />
    <path d="M10 8v3.5M10 14h.01" />
  </>
);
export const InfoIcon = make(
  <>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 9v4.5M10 6.5h.01" />
  </>
);
export const ErrorIcon = make(
  <>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m7.5 7.5 5 5M12.5 7.5l-5 5" />
  </>
);
export const SearchIcon = make(
  <>
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="m12.5 12.5 4 4" />
  </>
);
export const BellIcon = make(
  <>
    <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0 0 10 3Z" />
    <path d="M8.5 15.5a1.6 1.6 0 0 0 3 0" />
  </>
);
export const XIcon = make(<path d="m5 5 10 10M15 5 5 15" />);
export const ChevronRightIcon = make(<path d="m7.5 4.5 5 5.5-5 5.5" />);
export const ChevronLeftIcon = make(<path d="m12.5 4.5-5 5.5 5 5.5" />);
export const FileIcon = make(
  <>
    <path d="M11.5 2.5H6A1.5 1.5 0 0 0 4.5 4v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5l-4-4Z" />
    <path d="M11.5 2.5v4h4" />
  </>
);
export const BoxIcon = make(
  <>
    <path d="M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5Z" />
    <path d="m3 6 7 3.5L17 6M10 9.5v8" />
  </>
);
export const ScanIcon = make(
  <>
    <path d="M3 6.5V4a1 1 0 0 1 1-1h2.5M13.5 3H16a1 1 0 0 1 1 1v2.5M17 13.5V16a1 1 0 0 1-1 1h-2.5M6.5 17H4a1 1 0 0 1-1-1v-2.5" />
    <path d="M3 10h14" />
  </>
);
export const LeafIcon = make(
  <>
    <path d="M4 16c0-7 4.5-11 12-12 0 7.5-4 12-12 12Z" />
    <path d="M4 16c2.5-3.5 5-6 8-8" />
  </>
);
export const ShieldIcon = make(
  <>
    <path d="M10 2.5 16 5v4.5c0 4-2.6 6.8-6 8-3.4-1.2-6-4-6-8V5l6-2.5Z" />
    <path d="m7.3 10 1.9 1.9 3.6-3.8" />
  </>
);
export const SparkIcon = make(
  <>
    <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M4.7 15.3l2.1-2.1M13.2 6.8l2.1-2.1" />
  </>
);
export const ImageIcon = make(
  <>
    <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
    <circle cx="7.5" cy="8" r="1.5" />
    <path d="m4 14 4-4 3 3 2.5-2.5L17 14" />
  </>
);
export const RefreshIcon = make(
  <>
    <path d="M16 4v4h-4" />
    <path d="M15.5 8A6 6 0 1 0 16 11.5" />
  </>
);
export const SettingsIcon = make(
  <>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
  </>
);
export const LayersIcon = make(
  <>
    <path d="m10 3 7.5 4L10 11 2.5 7 10 3Z" />
    <path d="m2.5 10.5 7.5 4 7.5-4M2.5 14l7.5 4 7.5-4" />
  </>
);
export const KeyIcon = make(
  <>
    <circle cx="6.5" cy="13.5" r="3.5" />
    <path d="m9 11 7.5-7.5M14 6l2 2M12 8l1.5 1.5" />
  </>
);
export const LoginIcon = make(
  <>
    <path d="M12 3.5h3.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H12" />
    <path d="m8.5 13.5 3.5-3.5-3.5-3.5M12 10H3.5" />
  </>
);
export const BlockIcon = make(
  <>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m4.7 4.7 10.6 10.6" />
  </>
);
export const UsersIcon = make(
  <>
    <circle cx="7" cy="6.5" r="2.5" />
    <path d="M2.5 16.5c.5-2.7 2.3-4.2 4.5-4.2s4 1.5 4.5 4.2" />
    <circle cx="13.5" cy="7.5" r="2" />
    <path d="M14.5 12.4c1.7.4 2.7 1.7 3 3.6" />
  </>
);
export const BuildingIcon = make(
  <>
    <path d="M4 17V4.5A1.5 1.5 0 0 1 5.5 3h6A1.5 1.5 0 0 1 13 4.5V17" />
    <path d="M13 8h2.5A1.5 1.5 0 0 1 17 9.5V17M3 17h14M7 6.5h3M7 9.5h3M7 12.5h3" />
  </>
);
export const ChartIcon = make(
  <>
    <path d="M3.5 3.5v13h13" />
    <path d="M7 16.5v-5M10.5 16.5v-9M14 16.5v-3" />
  </>
);
export const ClockIcon = make(
  <>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 6v4l2.5 2" />
  </>
);
