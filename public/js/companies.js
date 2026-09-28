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

let plansById = {};

async function loadPlans() {
  const plans = await api.get("/api/admin/plans");
  plansById = Object.fromEntries(plans.map((p) => [p.id, p]));

  const planSelect = document.getElementById("planId");
  planSelect.innerHTML = "";
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "— geen plan —";
  planSelect.appendChild(noneOption);
  for (const plan of plans) {
    const option = document.createElement("option");
    option.value = plan.id;
    option.textContent = plan.name;
    planSelect.appendChild(option);
  }
}

async function loadInvitesPanel(company) {
  const panel = document.getElementById("invites-panel");
  panel.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";

  const title = document.createElement("h2");
  title.textContent = `Company Admin uitnodigen — ${company.name}`;
  card.appendChild(title);

  const form = document.createElement("form");
  form.innerHTML = `
    <label>E-mail <input type="email" id="invite-email" required /></label>
    <label>Voornaam <input id="invite-firstName" /></label>
    <label>Achternaam <input id="invite-lastName" /></label>
    <button type="submit">Uitnodiging aanmaken</button>
  `;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api.post(`/api/admin/companies/${company.id}/invites`, {
        email: document.getElementById("invite-email").value,
        firstName: document.getElementById("invite-firstName").value || undefined,
        lastName: document.getElementById("invite-lastName").value || undefined
      });
      form.reset();
      showActivationUrl(result.activationUrl);
      await renderInvitesList(company.id, card);
    } catch (error) {
      showError(error.message);
    }
  });
  card.appendChild(form);

  const urlBox = document.createElement("p");
  urlBox.id = "activation-url-box";
  card.appendChild(urlBox);

  const list = document.createElement("div");
  list.id = "invites-list";
  card.appendChild(list);

  panel.appendChild(card);

  await renderInvitesList(company.id, card);
}

function showActivationUrl(url) {
  const box = document.getElementById("activation-url-box");
  if (!box) return;
  box.innerHTML = "";
  const note = document.createElement("strong");
  note.textContent = "Activatielink (wordt maar één keer getoond, deel deze zelf met de Company Admin): ";
  const link = document.createElement("input");
  link.value = url;
  link.readOnly = true;
  link.style.width = "100%";
  link.addEventListener("click", () => link.select());
  box.appendChild(note);
  box.appendChild(link);
}

async function renderInvitesList(companyId, card) {
  const invites = await api.get(`/api/admin/companies/${companyId}/invites`);
  const list = card.querySelector("#invites-list");
  list.innerHTML = "";

  if (invites.length === 0) {
    list.textContent = "Nog geen uitnodigingen.";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>E-mail</th><th>Status</th><th>Verloopt</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");

  for (const invite of invites) {
    const tr = document.createElement("tr");
    for (const value of [invite.email, invite.status, new Date(invite.expires_at).toLocaleString("nl-NL")]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    const actionsTd = document.createElement("td");
    if (invite.status === "pending") {
      const revokeBtn = document.createElement("button");
      revokeBtn.textContent = "Intrekken";
      revokeBtn.className = "secondary";
      revokeBtn.addEventListener("click", async () => {
        try {
          await api.post(`/api/admin/companies/${companyId}/invites/${invite.id}/revoke`);
          await renderInvitesList(companyId, card);
        } catch (error) {
          showError(error.message);
        }
      });
      actionsTd.appendChild(revokeBtn);
    }
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  list.appendChild(table);
}

async function loadCompanies() {
  const companies = await api.get("/api/admin/companies");
  const rows = document.getElementById("rows");
  rows.innerHTML = "";

  for (const company of companies) {
    const tr = document.createElement("tr");

    for (const value of [company.id, company.name, company.slug]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }

    const planTd = document.createElement("td");
    const planSelect = document.createElement("select");
    fillSelect(
      planSelect,
      [{ value: "", label: "— geen plan —" }, ...Object.values(plansById).map((p) => ({ value: p.id, label: p.name }))]
    );
    planSelect.value = company.plan_id ?? "";
    planSelect.addEventListener("change", async () => {
      try {
        await api.patch(`/api/admin/companies/${company.id}`, {
          planId: planSelect.value ? Number(planSelect.value) : null
        });
      } catch (error) {
        showError(error.message);
      }
    });
    planTd.appendChild(planSelect);
    tr.appendChild(planTd);

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
    const statusTd = document.createElement("td");
    statusTd.appendChild(statusSelect);
    tr.appendChild(statusTd);

    const actionsTd = document.createElement("td");
    const inviteBtn = document.createElement("button");
    inviteBtn.textContent = "Company Admin uitnodigen";
    inviteBtn.addEventListener("click", () => loadInvitesPanel(company));
    actionsTd.appendChild(inviteBtn);
    tr.appendChild(actionsTd);

    rows.appendChild(tr);
  }
}

document.getElementById("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const name = document.getElementById("name").value;
    const slug = document.getElementById("slug").value;
    const planIdValue = document.getElementById("planId").value;
    await api.post("/api/admin/companies", {
      name,
      slug,
      planId: planIdValue ? Number(planIdValue) : undefined
    });
    event.target.reset();
    await loadCompanies();
  } catch (error) {
    showError(error.message);
  }
});

initNav(NAV_MENU)
  .then(async () => {
    await loadPlans();
    await loadCompanies();
  })
  .catch((error) => showError(error.message));
