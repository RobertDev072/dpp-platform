// Gedeelde 18px stroke-iconen (geen icon-library). Altijd decoratief: de knop zelf
// draagt de tekst of een title/aria-label (tooltip).
function Svg({ children, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const PlusIcon = (p) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const UploadIcon = (p) => (<Svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Svg>);
export const DownloadIcon = (p) => (<Svg {...p}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></Svg>);
export const EyeIcon = (p) => (<Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Svg>);
export const CopyIcon = (p) => (<Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>);
export const PrinterIcon = (p) => (<Svg {...p}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></Svg>);
export const QrIcon = (p) => (<Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M20 20h.01M17 20h-3" /></Svg>);
export const EditIcon = (p) => (<Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>);
export const ExternalIcon = (p) => (<Svg {...p}><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Svg>);
export const BoxIcon = (p) => (<Svg {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5M12 13v8" /></Svg>);
export const FileIcon = (p) => (<Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></Svg>);
export const ChartIcon = (p) => (<Svg {...p}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></Svg>);
export const CheckIcon = (p) => (<Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>);
export const AlertIcon = (p) => (<Svg {...p}><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></Svg>);
export const SparkIcon = (p) => (<Svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></Svg>);
export const SearchIcon = (p) => (<Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>);
export const HistoryIcon = (p) => (<Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 3" /></Svg>);
