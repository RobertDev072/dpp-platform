// Gedeelde DOM-helpers. Alle tekst gaat via textContent / text nodes — nooit innerHTML met
// data uit de API. Alles hangt onder één globale namespace: window.DPP.
(function () {
  const DPP = (window.DPP = window.DPP || {});

  const ROLE_LABELS = {
    system_owner: "System Owner",
    company_admin: "Company Admin",
    product_manager: "Product Manager",
    compliance_manager: "Compliance Manager",
    company_user: "Medewerker",
    viewer: "Viewer"
  };

  const STATUS_LABELS = {
    draft: "Concept",
    review: "In review",
    published: "Gepubliceerd",
    archived: "Gearchiveerd",
    active: "Actief",
    inactive: "Inactief",
    blocked: "Geblokkeerd",
    suspended: "Gedeactiveerd",
    pending: "Openstaand",
    expired: "Verlopen",
    accepted: "Geaccepteerd",
    revoked: "Ingetrokken"
  };

  // el("button", { className: "btn", text: "Opslaan", attrs: { type: "submit" }, on: { click: fn } }, ...children)
  // children: Node, string/number (wordt text node), of arrays daarvan; null/undefined/false worden overgeslagen.
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    const p = props || {};
    if (p.className) node.className = p.className;
    if (p.text !== undefined && p.text !== null) node.textContent = String(p.text);
    if (p.attrs) {
      for (const [key, value] of Object.entries(p.attrs)) {
        if (value === undefined || value === null || value === false) continue;
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    if (p.dataset) {
      for (const [key, value] of Object.entries(p.dataset)) node.dataset[key] = String(value);
    }
    if (p.on) {
      for (const [event, handler] of Object.entries(p.on)) node.addEventListener(event, handler);
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleString("nl-NL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function formatNumber(value) {
    if (value === null || value === undefined) return "—";
    return Number(value).toLocaleString("nl-NL");
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || "—";
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || "—";
  }

  function statusBadge(status) {
    return el("span", { className: `badge badge-${status || "unknown"}`, text: statusLabel(status) });
  }

  function fullName(user) {
    if (!user) return "—";
    const name = [user.first_name ?? user.firstName, user.last_name ?? user.lastName].filter(Boolean).join(" ");
    return name || user.email || "—";
  }

  // columns: [{ label, render: (row) => Node | string, className? }]
  function renderTable(container, { columns, rows, empty = "Geen gegevens gevonden", onRowClick }) {
    clear(container);
    if (!rows || rows.length === 0) {
      container.appendChild(el("div", { className: "empty-state", text: empty }));
      return;
    }
    const thead = el("thead", null, el("tr", null, columns.map((c) => el("th", { className: c.className, text: c.label }))));
    const tbody = el("tbody");
    for (const row of rows) {
      const tr = el(
        "tr",
        onRowClick ? { className: "clickable", on: { click: () => onRowClick(row) } } : null,
        columns.map((c) => {
          const value = c.render(row);
          return el("td", { className: c.className, attrs: { "data-label": c.label } }, value === "" || value == null ? "—" : value);
        })
      );
      tbody.appendChild(tr);
    }
    container.appendChild(el("div", { className: "table-wrap" }, el("table", { className: "table" }, thead, tbody)));
  }

  function statCard({ label, value, hint, tone }) {
    return el(
      "div",
      { className: `stat-card${tone ? ` stat-${tone}` : ""}` },
      el("div", { className: "stat-label", text: label }),
      el("div", { className: "stat-value", text: typeof value === "number" ? formatNumber(value) : value ?? "—" }),
      hint ? el("div", { className: "stat-hint", text: hint }) : null
    );
  }

  function flashRegion() {
    let region = document.getElementById("flash");
    if (!region) {
      region = el("div", { attrs: { id: "flash", "aria-live": "polite" } });
      const content = document.getElementById("content") || document.body;
      content.prepend(region);
    }
    return region;
  }

  function showMessage(message, kind) {
    const region = flashRegion();
    clear(region);
    const box = el(
      "div",
      { className: `alert alert-${kind}` },
      el("span", { text: message }),
      el("button", { className: "alert-close", text: "×", attrs: { type: "button", "aria-label": "Sluiten" }, on: { click: () => clear(region) } })
    );
    region.appendChild(box);
    if (kind === "success") setTimeout(() => box.isConnected && clear(region), 5000);
  }

  function showError(messageOrError) {
    const message = messageOrError instanceof Error ? messageOrError.message : String(messageOrError);
    showMessage(message, "error");
  }

  function showSuccess(message) {
    showMessage(message, "success");
  }

  // Generieke modal. body: Node. actions: [{ label, className, onClick(close) }]
  function openModal({ title, body, actions = [], wide = false }) {
    const overlay = el("div", { className: "modal-overlay", attrs: { role: "dialog", "aria-modal": "true" } });
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const footer = actions.length
      ? el(
          "div",
          { className: "modal-actions" },
          actions.map((a) =>
            el("button", {
              className: a.className || "btn",
              text: a.label,
              attrs: { type: "button" },
              on: { click: () => a.onClick(close) }
            })
          )
        )
      : null;
    const modal = el(
      "div",
      { className: `modal${wide ? " modal-wide" : ""}` },
      el(
        "div",
        { className: "modal-header" },
        el("h2", { text: title }),
        el("button", { className: "modal-close", text: "×", attrs: { type: "button", "aria-label": "Sluiten" }, on: { click: close } })
      ),
      el("div", { className: "modal-body" }, body),
      footer
    );
    overlay.appendChild(modal);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    const focusable = modal.querySelector("input, select, textarea, button:not(.modal-close)");
    if (focusable) focusable.focus();
    return { close, modal };
  }

  // Toont gevoelige gegevens (tijdelijk wachtwoord, activatielink) precies één keer.
  // De waarden worden niet bewaard in de pagina-state; na sluiten zijn ze weg.
  function showSecretOnce({ title, intro, fields }) {
    const body = el(
      "div",
      { className: "secret-once" },
      el("p", { className: "alert alert-warning", text: "Deze gegevens worden maar één keer getoond. Kopieer ze nu en deel ze via een veilig intern kanaal." }),
      intro ? el("p", { text: intro }) : null,
      fields.map((f) => {
        const input = el("input", { className: "input mono", attrs: { type: "text", readonly: true, value: f.value } });
        const copyBtn = el("button", {
          className: "btn btn-secondary",
          text: "Kopiëren",
          attrs: { type: "button" },
          on: {
            click: async () => {
              try {
                await navigator.clipboard.writeText(f.value);
                copyBtn.textContent = "Gekopieerd";
              } catch {
                input.select();
              }
            }
          }
        });
        return el("div", { className: "form-field" }, el("label", { text: f.label }), el("div", { className: "input-group" }, input, copyBtn));
      })
    );
    return openModal({ title, body, actions: [{ label: "Ik heb het opgeslagen", className: "btn", onClick: (close) => close() }] });
  }

  // Leest benoemde velden van een form. Lege strings -> undefined (zodat zod optional werkt),
  // type="number" -> Number, type="checkbox" -> boolean.
  function formData(form) {
    const data = {};
    for (const field of form.elements) {
      if (!field.name || field.disabled) continue;
      if (field.type === "checkbox") {
        data[field.name] = field.checked;
      } else if (field.value === "") {
        data[field.name] = undefined;
      } else if (field.type === "number") {
        data[field.name] = Number(field.value);
      } else {
        data[field.name] = field.value;
      }
    }
    return data;
  }

  // Bouwt een form-veld: { name, label, type, value, required, options: [{value,label}], placeholder, help, rows }
  function field(spec) {
    const id = `f-${spec.name}-${Math.random().toString(36).slice(2, 8)}`;
    let control;
    if (spec.type === "select") {
      control = el(
        "select",
        { className: "input", attrs: { id, name: spec.name, required: spec.required } },
        (spec.options || []).map((o) => el("option", { text: o.label, attrs: { value: o.value, selected: String(o.value) === String(spec.value ?? "") } }))
      );
    } else if (spec.type === "textarea") {
      control = el("textarea", { className: "input", attrs: { id, name: spec.name, rows: spec.rows || 4, required: spec.required, placeholder: spec.placeholder, maxlength: spec.maxlength } });
      control.value = spec.value ?? "";
    } else {
      control = el("input", {
        className: "input",
        attrs: {
          id,
          name: spec.name,
          type: spec.type || "text",
          required: spec.required,
          placeholder: spec.placeholder,
          min: spec.min,
          max: spec.max,
          maxlength: spec.maxlength,
          autocomplete: spec.autocomplete
        }
      });
      control.value = spec.value ?? "";
    }
    if (spec.disabled) control.disabled = true;
    return el(
      "div",
      { className: `form-field${spec.full ? " full" : ""}` },
      el("label", { text: spec.label + (spec.required ? " *" : ""), attrs: { for: id } }),
      control,
      spec.help ? el("div", { className: "help", text: spec.help }) : null
    );
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function pageHeader({ title, subtitle, actions = [] }) {
    return el(
      "div",
      { className: "page-header" },
      el("div", null, el("h1", { text: title }), subtitle ? el("p", { className: "subtitle", text: subtitle }) : null),
      actions.length ? el("div", { className: "page-actions" }, actions) : null
    );
  }

  Object.assign(DPP, {
    ROLE_LABELS,
    STATUS_LABELS,
    el,
    append,
    clear,
    formatDate,
    formatDateTime,
    formatNumber,
    roleLabel,
    statusLabel,
    statusBadge,
    fullName,
    renderTable,
    statCard,
    showError,
    showSuccess,
    openModal,
    showSecretOnce,
    formData,
    field,
    getQueryParam,
    pageHeader
  });
})();
