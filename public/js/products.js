const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

async function loadProducts() {
  const products = await api.get("/api/products");
  const rows = document.getElementById("rows");
  rows.innerHTML = "";

  for (const product of products) {
    const tr = document.createElement("tr");

    for (const value of [product.id, product.name, product.brand || "—", product.model || "—", product.status]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    const actionsTd = document.createElement("td");
    if (["company_admin", "company_user"].includes(currentUser.role) && product.status !== "archived") {
      const archiveBtn = document.createElement("button");
      archiveBtn.textContent = "Archiveren";
      archiveBtn.className = "secondary";
      archiveBtn.addEventListener("click", async () => {
        try {
          await api.delete(`/api/products/${product.id}`);
          await loadProducts();
        } catch (error) {
          showError(error.message);
        }
      });
      actionsTd.appendChild(archiveBtn);
    }
    tr.appendChild(actionsTd);

    rows.appendChild(tr);
  }
}

document.getElementById("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = {
      name: document.getElementById("name").value,
      brand: document.getElementById("brand").value || undefined,
      model: document.getElementById("model").value || undefined,
      sku: document.getElementById("sku").value || undefined
    };
    await api.post("/api/products", body);
    event.target.reset();
    await loadProducts();
  } catch (error) {
    showError(error.message);
  }
});

initNav(NAV_MENU)
  .then((user) => {
    if (!["company_admin", "company_user"].includes(user.role)) {
      document.getElementById("create-form").classList.add("hidden");
    }
    return loadProducts();
  })
  .catch((error) => showError(error.message));
