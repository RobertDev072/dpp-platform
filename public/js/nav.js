const ADMIN_MENU = [
  { label: "Dashboard", href: "/admin/index.html" },
  { label: "Bedrijven", href: "/admin/companies.html" },
  { label: "Gebruikers", href: "/admin/users.html" },
  { label: "Producten", href: "/admin/products.html" },
  { label: "Licenties", href: "/admin/licenses.html" },
  { label: "Audit Log", href: "/admin/audit.html" }
];

const COMPANY_MENU = [
  { label: "Dashboard", href: "/company/index.html" },
  { label: "Producten", href: "/company/products.html" },
  { label: "Gebruikers", href: "/company/users.html", roles: ["company_admin"] },
  { label: "Documenten", href: "/company/documents.html" },
  { label: "QR-codes", href: "/company/qrcodes.html" },
  { label: "Rapportages", href: "/company/reports.html", roles: ["company_admin"] },
  { label: "Instellingen", href: "/company/settings.html", roles: ["company_admin"] }
];

let currentUser = null;

function renderMenu(menuItems) {
  const navEl = document.getElementById("nav-links");
  if (!navEl || !menuItems) {
    return;
  }

  navEl.innerHTML = "";
  for (const item of menuItems) {
    if (item.roles && !item.roles.includes(currentUser.role)) {
      continue;
    }
    const a = document.createElement("a");
    a.href = item.href;
    a.textContent = item.label;
    navEl.appendChild(a);
  }
}

async function initNav(menuItems) {
  currentUser = await api.get("/api/auth/me");

  renderMenu(menuItems);

  const whoami = document.getElementById("whoami");
  if (whoami) {
    whoami.textContent = `${currentUser.email} (${currentUser.role})`;
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api.post("/api/auth/logout");
      window.location.href = "/login.html";
    });
  }

  return currentUser;
}
