// Shared UI helpers: escaping, formatting, tables, toasts and form dialogs.

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
export const money = (n) => inr.format(Number(n) || 0);
export const num = (n, d = 2) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: d }));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-09-02 09:05:00" -> "2 Sep 2026, 09:05"
export function dt(s) {
  if (!s) return "";
  const [d, t] = String(s).split(/[ T]/);
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}${t ? ", " + t.slice(0, 5) : ""}`;
}
export const time = (s) => (s ? String(s).split(/[ T]/)[1]?.slice(0, 5) : "");

export const badge = (status, label) =>
  `<span class="badge s-${esc(String(status).toLowerCase().replace(/\s+/g, "-"))}">${esc(label || status)}</span>`;

// Render rows as a table. cols: [{ key, label, num, render(row) }]
export function table(rows, cols, empty = "Nothing here yet.") {
  if (!rows.length) return `<div class="panel"><div class="empty">${empty}</div></div>`;
  const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => `<tr>${cols.map((c) => {
    const v = c.render ? c.render(r) : r[c.key];
    const isNull = !c.render && (v === null || v === undefined);
    return `<td class="${c.num ? "num" : ""}${isNull ? " null" : ""}">${isNull ? "NULL" : c.render ? v : esc(v)}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Generic result table for SQL output (column names come from MySQL).
export function resultTable(columns, rows) {
  return table(rows, columns.map((c) => ({
    key: c, label: c,
    num: rows.some((r) => typeof r[c] === "number"),
  })), "The query returned no rows.");
}

// ---------- toasts ----------
export function toast(message, { error = false, details = [], label } = {}) {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
  el.innerHTML = `<strong>${esc(message)}</strong>${label ? `<div class="db-label">${esc(label)}</div>` : ""}${details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}`;
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), error ? 7000 : details.length ? 9000 : 4000);
}
export const toastError = (err) => toast(err.message, { error: true, label: err.mysql ? `MySQL error ${err.mysql.errno} (${err.mysql.code})` : "" });

// ---------- form dialog ----------
// fields: [{ name, label, type, value, options:[{value,label}], required, min, max, step, placeholder, hint }]
export function openForm({ title, intro = "", fields, submitLabel = "Save", onSubmit }) {
  const dialog = document.getElementById("modal");
  dialog.innerHTML = `
    <form method="dialog" class="stack" novalidate>
      <h2>${esc(title)}</h2>
      ${intro}
      ${fields.map(fieldHtml).join("")}
      <p class="form-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
      </div>
    </form>`;
  const form = dialog.querySelector("form");
  const errorEl = form.querySelector(".form-error");
  form.querySelector("[data-cancel]").onclick = () => dialog.close();
  form.addEventListener("input", () => { errorEl.textContent = ""; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      const bad = form.querySelector(":invalid");
      errorEl.textContent = `Check “${bad.closest("label")?.firstChild?.textContent?.trim() || bad.name}”: ${bad.validationMessage}`;
      bad.focus();
      return;
    }
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      await onSubmit(values, form);
      dialog.close();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  };
  dialog.showModal();
  form.querySelector("input, select, textarea")?.focus();
  return form;
}

function fieldHtml(f) {
  const attrs = [
    `name="${esc(f.name)}"`, f.required !== false ? "required" : "",
    f.min !== undefined ? `min="${esc(f.min)}"` : "", f.max !== undefined ? `max="${esc(f.max)}"` : "",
    f.step !== undefined ? `step="${esc(f.step)}"` : "", f.placeholder ? `placeholder="${esc(f.placeholder)}"` : "",
    f.pattern ? `pattern="${esc(f.pattern)}"` : "", f.maxlength ? `maxlength="${f.maxlength}"` : "",
  ].join(" ");
  let control;
  if (f.type === "select") {
    control = `<select ${attrs}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  } else if (f.type === "html") {
    return f.html;
  } else {
    control = `<input type="${f.type || "text"}" value="${esc(f.value ?? "")}" ${attrs}>`;
  }
  return `<label>${esc(f.label)}${control}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</label>`;
}

export function confirmDialog(title, message, confirmLabel = "Confirm") {
  return new Promise((resolve) => {
    let ok = false;
    openForm({
      title, intro: `<p>${esc(message)}</p>`, fields: [], submitLabel: confirmLabel,
      onSubmit: async () => { ok = true; },
    });
    document.getElementById("modal").addEventListener("close", () => resolve(ok), { once: true });
  });
}

// Light SQL keyword highlighting for code blocks.
const KW = /\b(SELECT|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|ON|AND|OR|AS|GROUP BY|ORDER BY|DESC|ASC|COUNT|SUM|IFNULL|IS|NULL|NOT|CREATE|VIEW|TRIGGER|BEFORE|AFTER|INSERT|UPDATE|DELETE|INTO|VALUES|SET|FOR EACH ROW|BEGIN|END|IF|THEN|DECLARE|SIGNAL|SQLSTATE|EXISTS|LIMIT|ROUND|DATE|IN)\b/g;
export const sql = (text) => `<pre class="code">${esc(text).replace(KW, '<span class="kw">$1</span>')}</pre>`;

export const statusOptions = (list) => list.map((s) => ({ value: s, label: s }));
