import AppShell from "@/components/AppShell";
import { ADMIN_MENU } from "@/lib/nav";

export default function AdminLayout({ children }) {
  return <AppShell menu={ADMIN_MENU}>{children}</AppShell>;
}
