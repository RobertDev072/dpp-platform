export function VeriPassoWordmark({ background = "light", className = "h-7 w-auto" }) {
  const src = background === "dark" ? "/brand/veripasso-logo-dark.svg" : "/brand/veripasso-logo-light.svg";
  return <img src={src} alt="VeriPasso" className={className} />;
}

export function VeriPassoIcon({ className = "h-5 w-5" }) {
  return <img src="/brand/veripasso-icon.svg" alt="" aria-hidden="true" className={className} />;
}
