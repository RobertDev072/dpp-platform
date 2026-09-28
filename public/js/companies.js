const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function loadCompanies() {
  const companies = await api.get("/api/admin/companies");
  const rows = document.getElementById("rows");
  rows.innerHTML = "";

  for (const company of companies) {
    const tr = document.createElement("tr");

    const statusSelect = document.createElement("select");
    for (const status of ["active", "suspended", "archived"]) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      option.selected = company.status === status;
      statusSelect.appendChild(option);
    }
    statusSelect.addEventListener("change", async () => {
      try {
        await api.patch(`/api/admin/companies/${company.id}`, { status: statusSelect.value });
      } catch (error) {
        showError(error.message);
      }
    });

    for (const value of [company.id, company.name, company.slug]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    const statusTd = document.createElement("td");
    statusTd.appendChild(statusSelect);
    tr.appendChild(statusTd);

    rows.appendChild(tr);
  }
}

document.getElementById("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const name = document.getElementById("name").value;
    const slug = document.getElementById("slug").value;
    await api.post("/api/admin/companies", { name, slug });
    event.target.reset();
    await loadCompanies();
  } catch (error) {
    showError(error.message);
  }
});

initNav().then(loadCompanies).catch((error) => showError(error.message));
