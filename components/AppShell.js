"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { roleLabel } from "@/lib/labels";
import { homeHrefForRole } from "@/lib/nav";
import { VeriPassoWordmark } from "@/components/landing/VeriPassoLogo";
import { GlobalSearch, MobileSearch, NotificationsMenu } from "@/components/HeaderTools";

// Kleine, met de hand getekende 20px stroke-iconen (geen icon-library).
const NAV_ICONS = {
  home: (
    <>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8.5V16a1 1 0 0 0 1 1h2.5v-4h3v4H14a1 1 0 0 0 1-1V8.5" />
    </>
  ),
  building: (
    <>
      <path d="M4 17V4.5A1.5 1.5 0 0 1 5.5 3h6A1.5 1.5 0 0 1 13 4.5V17" />
      <path d="M13 8h2.5A1.5 1.5 0 0 1 17 9.5V17M3 17h14" />
      <path d="M7 6.5h3M7 9.5h3M7 12.5h3" />
    </>
  ),
  users: (
    <>
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16.5c.5-2.7 2.3-4.2 4.5-4.2s4 1.5 4.5 4.2" />
      <circle cx="13.5" cy="7.5" r="2" />
      <path d="M14.5 12.4c1.7.4 2.7 1.7 3 3.6" />
    </>
  ),
  box: (
    <>
      <path d="M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5Z" />
      <path d="m3 6 7 3.5L17 6M10 9.5v8" />
    </>
  ),
  "credit-card": (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M2.5 8.5h15M5.5 12.5h4" />
    </>
  ),
  scroll: (
    <>
      <path d="M6.5 3H15a1.5 1.5 0 0 1 1.5 1.5V15a2 2 0 0 1-2 2H5.5" />
      <path d="M6.5 3A1.5 1.5 0 0 0 5 4.5V15a2 2 0 0 1-2 2h2.5" />
      <path d="M8.5 7h4.5M8.5 10h4.5M8.5 13h2.5" />
    </>
  ),
  file: (
    <>
      <path d="M11.5 2.5H6A1.5 1.5 0 0 0 4.5 4v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5l-4-4Z" />
      <path d="M11.5 2.5v4h4M7.5 11h5M7.5 14h3" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <path d="M12 12h2.5v2.5H12zM17 12v2.5M14.5 17H12M17 17h.01" />
    </>
  ),
  team: (
    <>
      <circle cx="10" cy="6" r="2.5" />
      <path d="M5.5 16.5c.5-2.7 2.3-4.2 4.5-4.2s4 1.5 4.5 4.2" />
      <path d="M15.5 6.8a2 2 0 1 1 1 3.7M17.4 15.5c-.3-1.6-1.1-2.7-2.4-3.2M4.5 6.8a2 2 0 1 0-1 3.7M2.6 15.5c.3-1.6 1.1-2.7 2.4-3.2" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 3.5v13h13" />
      <path d="M7 16.5v-5M10.5 16.5v-9M14 16.5v-3" />
    </>
  ),
  cog: (
    <>
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2.5v2.2M10 15.3v2.2M17.5 10h-2.2M4.7 10H2.5M15.3 4.7l-1.6 1.6M6.3 13.7l-1.6 1.6M15.3 15.3l-1.6-1.6M6.3 6.3 4.7 4.7" />
    </>
  ),
  partners: (
    <>
      <circle cx="10" cy="4.5" r="2" />
      <circle cx="4.5" cy="14.5" r="2" />
      <circle cx="15.5" cy="14.5" r="2" />
      <path d="M8.9 6.3 5.6 12.7M11.1 6.3l3.3 6.4M6.5 14.5h7" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M4 17c.7-3.2 3-5 6-5s5.3 1.8 6 5" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3.5 6.5 6.5 5 6.5-5" />
    </>
  ),
  pulse: (
    <>
      <path d="M2.5 10.5h3l2-5 3 9 2-5.5 1 1.5h4" />
    </>
  ),
  upload: (
    <>
      <path d="M10 13V3.5M6 7.5l4-4 4 4" />
      <path d="M3.5 13v2.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V13" />
    </>
  ),
  printer: (
    <>
      <path d="M5.5 7.5V3h9v4.5" />
      <rect x="2.5" y="7.5" width="15" height="6.5" rx="1.5" />
      <path d="M5.5 12h9v5h-9z" />
    </>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.8 7.7A2.3 2.3 0 0 1 12.3 8c0 1.5-2.3 1.8-2.3 3.2M10 14.2h.01" />
    </>
  )
};

function NavIcon({ name, className = "" }) {
  const paths = NAV_ICONS[name];
  if (!paths) {
    return null;
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

// Labels voor padsegmenten die niet in het menu staan (breadcrumb).
const EXTRA_SEGMENT_LABELS = {
  new: "Nieuw",
  nieuw: "Nieuw",
  uitnodigen: "Uitnodigen",
  profiel: "Profiel",
  products: "Producten",
  rapportages: "Rapportages",
  print: "Print & labels"
};

function looksLikeId(segment) {
  return /^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment);
}

function buildBreadcrumb(pathname, menu) {
  if (!menu.length) {
    return [];
  }
  const root = menu[0];
  const crumbs = [{ label: root.label, href: root.href }];

  let match = null;
  for (const item of menu) {
    if (item.href === root.href) {
      continue;
    }
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!match || item.href.length > match.href.length) {
        match = item;
      }
    }
  }
  if (match) {
    crumbs.push({ label: match.label, href: match.href });
  }

  const base = match ? match.href : root.href;
  if (pathname !== base && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length).split("/").filter(Boolean);
    for (const segment of rest) {
      const decoded = decodeURIComponent(segment);
      const label =
        EXTRA_SEGMENT_LABELS[decoded] ||
        (looksLikeId(decoded) ? "Detail" : decoded.charAt(0).toUpperCase() + decoded.slice(1));
      crumbs.push({ label });
    }
  }

  return crumbs;
}

function initialsOf(user) {
  const letters = [user.firstName, user.lastName]
    .filter(Boolean)
    .map((part) => part.trim().charAt(0).toUpperCase())
    .join("");
  return letters || (user.email || "?").charAt(0).toUpperCase();
}

function displayNameOf(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

export default function AppShell({ menu, children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    api
      .get("/api/auth/me")
      .then((data) => {
        if (!cancelled) {
          setUser(data);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // Gebruikersmenu sluiten bij klik buiten het menu.
  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  async function handleLogout() {
    await api.post("/api/auth/logout");
    window.location.href = "/login";
  }

  async function handleStopImpersonation() {
    const { restored } = await api.post("/api/admin/impersonate/stop");
    window.location.href = homeHrefForRole(restored.role);
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Laden...
      </div>
    );
  }

  const visibleMenu = menu.filter((item) => !item.roles || item.roles.includes(user.role));
  const rootHref = menu[0]?.href;
  const breadcrumb = buildBreadcrumb(pathname, visibleMenu);
  // Langste overeenkomende menu-item is actief (bijv. Print & labels binnen Bedrijfsinstellingen).
  const activeHref = visibleMenu
    .filter(
      (item) =>
        pathname === item.href ||
        (item.href !== rootHref && pathname.startsWith(`${item.href}/`)) ||
        (item.href === "/company/imports" && pathname === "/company/import")
    )
    .reduce((best, item) => (best && best.length >= item.href.length ? best : item.href), null);
  const profileHref = `${homeHrefForRole(user.role)}/profiel`;
  const initials = initialsOf(user);
  const displayName = displayNameOf(user);

  return (
    <div className="flex min-h-screen">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-slate-950 text-slate-100 transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <Link href={rootHref || "/"} className="flex items-center">
              <VeriPassoWordmark background="dark" className="h-7 w-auto" />
            </Link>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
              aria-label="Menu sluiten"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {user.companyName && (
            <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-slate-900 px-2.5 py-2">
              {user.companyLogo ? (
                <img
                  src={user.companyLogo}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded bg-white object-contain"
                />
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-emerald-500/15 text-xs font-semibold text-emerald-400">
                  {user.companyName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate text-sm text-slate-300">{user.companyName}</span>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {visibleMenu.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <NavIcon name={item.icon} className={isActive ? "text-white" : "text-slate-400"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-slate-800 px-3 py-3">
          <Link
            href={profileHref}
            className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-800"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-100">{displayName}</span>
              <span className="block truncate text-xs text-slate-400">{roleLabel(user.role)}</span>
            </span>
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {user.impersonator && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm text-white sm:px-6">
            <span>
              Je bekijkt de omgeving als <strong>{user.email}</strong>, ingelogd door{" "}
              {user.impersonator.email}.
            </span>
            <button
              type="button"
              onClick={handleStopImpersonation}
              className="shrink-0 rounded-lg bg-white/20 px-3 py-1 font-medium hover:bg-white/30"
            >
              Stop impersoneren
            </button>
          </div>
        )}

        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Menu openen"
              aria-expanded={mobileNavOpen}
              className="shrink-0 rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 md:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                {breadcrumb.map((crumb, index) => {
                  const isLast = index === breadcrumb.length - 1;
                  return (
                    <li
                      key={`${crumb.label}-${index}`}
                      className={`min-w-0 items-center gap-1.5 ${isLast ? "flex" : "hidden sm:flex"}`}
                    >
                      {index > 0 && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 20 20"
                          fill="none"
                          className="hidden shrink-0 text-slate-300 sm:block"
                          aria-hidden="true"
                        >
                          <path d="m7.5 4.5 5 5.5-5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {isLast || !crumb.href ? (
                        <span
                          className={`truncate ${isLast ? "font-medium text-slate-900" : "text-slate-500"}`}
                          aria-current={isLast ? "page" : undefined}
                        >
                          {crumb.label}
                        </span>
                      ) : (
                        <Link href={crumb.href} className="truncate text-slate-500 hover:text-slate-700">
                          {crumb.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden sm:block">
              <GlobalSearch />
            </div>
            <MobileSearch />
            <NotificationsMenu pathname={pathname} />

            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                  {initials}
                </span>
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-40 truncate text-sm font-medium text-slate-900">
                    {displayName}
                  </span>
                  <span className="block text-xs text-slate-500">{roleLabel(user.role)}</span>
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  className={`shrink-0 text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <p className="truncate text-sm font-medium text-slate-900">{displayName}</p>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                  </div>
                  <Link
                    href={profileHref}
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Profiel
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Uitloggen
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
