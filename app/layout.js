import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export const metadata = {
  title: { default: "VeriPasso", template: "%s | VeriPasso" },
  description: "VeriPasso: digitale productpaspoorten (DPP) met een vaste QR-code, volgens de Europese regels.",
  applicationName: "VeriPasso"
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
