import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata = {
  title: "DPP Platform",
  description: "Digital Product Passport platform voor beheer van producten, bedrijven en licenties."
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
