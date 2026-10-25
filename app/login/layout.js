// Inlogpagina hoort niet in zoekmachines (de website zelf wel: www.veripasso.com).
export const metadata = {
  title: "Inloggen | VeriPasso",
  description: "Log in bij VeriPasso om je digitale productpaspoorten te beheren.",
  robots: { index: false, follow: false }
};

export default function LoginLayout({ children }) {
  return children;
}
