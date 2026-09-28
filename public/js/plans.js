const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function loadPlans() {
  const plans = await api.get("/api/admin/plans");
  const rows = document.getElementById("rows");
  rows.innerHTML = "";

  for (const plan of plans) {
    const tr = document.createElement("tr");

    for (const value of [plan.id, plan.name, plan.max_users, plan.max_products]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    rows.appendChild(tr);
  }
}

document.getElementById("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = {
      name: document.getElementById("name").value,
      maxUsers: Number(document.getElementById("maxUsers").value),
      maxProducts: Number(document.getElementById("maxProducts").value)
    };
    await api.post("/api/admin/plans", body);
    event.target.reset();
    await loadPlans();
  } catch (error) {
    showError(error.message);
  }
});

initNav(NAV_MENU).then(loadPlans).catch((error) => showError(error.message));
