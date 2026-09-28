function renderStats(stats) {
  const el = document.getElementById("stats");
  if (!el) {
    return;
  }

  const tiles =
    stats.scope === "platform"
      ? [
          ["Bedrijven", stats.companies],
          ["Actieve bedrijven", stats.activeCompanies],
          ["Actieve gebruikers", stats.activeUsers],
          ["Producten (concept)", stats.products.draft],
          ["Gepubliceerde DPP's", stats.products.published],
          ["Gearchiveerd", stats.products.archived],
          ["QR-scans", stats.qrScans],
          ["Openstaande invites", stats.pendingInvites]
        ]
      : [
          ["Gebruikers", stats.activeUsers],
          ["Producten (concept)", stats.products.draft],
          ["Gepubliceerde DPP's", stats.products.published],
          ["Gearchiveerd", stats.products.archived],
          ["QR-scans", stats.qrScans]
        ];

  el.innerHTML = "";
  for (const [label, value] of tiles) {
    const card = document.createElement("div");
    card.className = "stat-card";

    const valueEl = document.createElement("div");
    valueEl.className = "stat-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "stat-label";
    labelEl.textContent = label;

    card.appendChild(valueEl);
    card.appendChild(labelEl);
    el.appendChild(card);
  }
}

const errorEl = document.getElementById("error");

initNav(NAV_MENU)
  .then(() => api.get("/api/dashboard/stats"))
  .then(renderStats)
  .catch((error) => {
    if (errorEl) {
      errorEl.textContent = error.message;
      errorEl.classList.remove("hidden");
    }
  });
