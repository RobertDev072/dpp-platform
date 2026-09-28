import AppShell from "@/components/AppShell";
import { COMPANY_MENU } from "@/lib/nav";

export default function CompanyLayout({ children }) {
  return <AppShell menu={COMPANY_MENU}>{children}</AppShell>;
}
