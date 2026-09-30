"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { PARTNER_MENU, homeHrefForRole } from "@/lib/nav";
import { api } from "@/lib/api";

// Het partnergebied is exclusief voor partner_admins: andere rollen worden naar
// hun eigen startpagina gestuurd (niet-ingelogden vangt api.js al af met /login).
export default function PartnerLayout({ children }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/auth/me")
      .then((user) => {
        if (cancelled) {
          return;
        }
        if (user.role !== "partner_admin") {
          window.location.href = homeHrefForRole(user.role);
          return;
        }
        setAllowed(true);
      })
      .catch(() => {
        // 401 stuurt api.js zelf door naar /login; overige fouten tonen de pagina's zelf.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Laden...
      </div>
    );
  }

  return <AppShell menu={PARTNER_MENU}>{children}</AppShell>;
}
