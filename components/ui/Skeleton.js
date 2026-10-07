export default function Skeleton({ className = "" }) {
  return <div aria-hidden="true" className={`block animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}
