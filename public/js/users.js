const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function fillSelect(select, options) {
  select.innerHTML = "";
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
}

let companiesById = {};

async function setupForm(user) {
  const roleSelect = document.getElementById("role");
  const companyField = document.getElementById("company-field");
  const companySelect = document.getElementById("companyId");

  if (user.role === "system_owner") {
    fillSelect(roleSelect, [
      { value: "system_owner", label: "System Owner" },
      { value: "company_admin", label: "Company Admin" },
      { value: "company_user", label: "Company User" },
      { value: "viewer", label: "Viewer" }
    ]);

    const companies = await api.get("/api/admin/companies");
    companiesById = Object.fromEntries(companies.map((c) => [c.id, c]));
    fillSelect(
      companySelect,
      companies.map((c) => ({ value: c.id, label: c.name }))
    );
  } else {
    companyField.classList.add("hidden");
    fillSelect(roleSelect, [
      { value: "company_admin", label: "Company Admin" },
      { value: "company_user", label: "Company User" },
      { value: "viewer", label: "Viewer" }
    ]);
  }
}

async function loadUsers() {
  const users = await api.get("/api/users");
  const rows = document.getElementById("rows");
  rows.innerHTML = "";

  for (const user of users) {
    const tr = document.createElement("tr");

    const companyLabel = user.company_id
      ? companiesById[user.company_id]?.name || `#${user.company_id}`
      : "—";

    for (const value of [user.id, user.email, companyLabel]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    tr.appendChild(document.createElement("td")).textContent = user.role;

    const statusSelect = document.createElement("select");
    fillSelect(statusSelect, [
      { value: "active", label: "active" },
      { value: "inactive", label: "inactive" }
    ]);
    statusSelect.value = user.status;
    statusSelect.addEventListener("change", async () => {
      try {
        await api.patch(`/api/users/${user.id}`, { status: statusSelect.value });
      } catch (error) {
        showError(error.message);
      }
    });

    const statusTd = document.createElement("td");
    statusTd.appendChild(statusSelect);
    tr.appendChild(statusTd);

    rows.appendChild(tr);
  }
}

document.getElementById("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const body = {
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
      firstName: document.getElementById("firstName").value || undefined,
      lastName: document.getElementById("lastName").value || undefined,
      role: document.getElementById("role").value
    };

    if (currentUser.role === "system_owner") {
      body.companyId = body.role === "system_owner" ? null : Number(document.getElementById("companyId").value);
    }

    await api.post("/api/users", body);
    event.target.reset();
    await loadUsers();
  } catch (error) {
    showError(error.message);
  }
});

initNav()
  .then(async (user) => {
    await setupForm(user);
    await loadUsers();
  })
  .catch((error) => showError(error.message));
