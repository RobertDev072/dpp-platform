// VeriPasso-woordmerk (beeldmerk + naam) voor de losse pagina's (inloggen, activeren,
// wachtwoord vergeten). background: "light" (standaard) of "dark".
export default function Logo({ className = "", background = "light" }) {
  const src = background === "dark" ? "/brand/veripasso-logo-dark.svg" : "/brand/veripasso-logo-light.svg";
  return <img src={src} alt="VeriPasso" className={`h-8 w-auto ${className}`} />;
}
