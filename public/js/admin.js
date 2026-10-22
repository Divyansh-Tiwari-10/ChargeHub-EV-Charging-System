// Admin pages: dashboard, stations, chargers, tariffs, users, activity, SQL reports, triggers, SQL console.
import { api } from "./api.js";
import { esc, money, num, dt, badge, table, resultTable, toast, toastError, openForm, confirmDialog, sql } from "./ui.js";

const head = (title, text = "", actions = "") =>
  `<div class="page-head"><div><h1>${esc(title)}</h1>${text ? `<p>${text}</p>` : ""}</div>${actions}</div>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fig = (v, l) => `<div class="figure"><div class="figure-value">${esc(v)}</div><div class="figure-label">${esc(l)}</div></div>`;

// Delete with confirmation; shows the MySQL reason if a foreign key blocks it.
async function remove(path, what, nav) {
  if (!(await confirmDialog(`Delete ${what}?`, "This can't be undone.", "Delete"))) return;
  try { await api(path, { method: "DELETE" }); toast(`Deleted ${what}`); nav.refresh(); }
  catch (err) { toastError(err); }
}

// ================= DASHBOARD =================
export async function dashboard(view) {
  const { totals: t, stationRevenue, active } = await api("/admin/stats");
  const maxRev = Math.max(...stationRevenue.map((s) => s.revenue), 1);
  const pct = (n) => (t.chargers ? (n / t.chargers) * 100 : 0);
  view.innerHTML = `
    ${head("Dashboard", `${t.stations} stations, ${t.chargers} chargers and ${t.users} registered drivers.`)}
    <div class="figures">
      ${fig(money(t.revenue), "Revenue collected")}
      ${fig(money(t.pending_amount), "Pending payments")}
      ${fig(`${num(t.energy_kwh)} kWh`, "Energy delivered")}
      ${fig(t.sessions, "Charging sessions")}
      ${fig(t.upcoming_bookings, "Upcoming bookings")}
    </div>
    <div class="grid-2 section">
      <section class="panel panel-pad">
        <h2>Charger status right now</h2>
        <p class="sub" style="margin:4px 0 14px">${t.chargers_available} free, ${t.chargers_busy} charging, ${t.chargers_down} out of service</p>
        <div class="split" role="img" aria-label="${t.chargers_available} free, ${t.chargers_busy} busy, ${t.chargers_down} out of service">
          <span style="width:${pct(t.chargers_available)}%;background:var(--go)"></span>
          <span style="width:${pct(t.chargers_busy)}%;background:var(--wait)"></span>
          <span style="width:${pct(t.chargers_down)}%;background:var(--stop)"></span>
        </div>
        <div class="legend"><span><i style="background:var(--go)"></i>Available</span><span><i style="background:var(--wait)"></i>Busy</span><span><i style="background:var(--stop)"></i>Out of service</span></div>
      </section>
      <section class="panel panel-pad">
        <h2>Revenue by station</h2>
        <p class="sub" style="margin:4px 0 14px">From the <code>v_station_revenue</code> view, successful payments only</p>
        <div class="bars">${stationRevenue.map((s) => `
          <div class="bar-row"><span>${esc(s.station_name)}<div class="sub">${plural(s.total_sessions, "session")}, ${num(s.total_energy_kwh)} kWh</div></span>
          <div class="bar-track"><div class="bar-fill" style="width:${(s.revenue / maxRev) * 100}%"></div></div>
          <span class="num">${money(s.revenue)}</span></div>`).join("")}</div>
      </section>
    </div>
    <section class="section">
      <h2>Charging now (${t.active_sessions})</h2>
      ${table(active, [
        { label: "Session", render: (s) => `#${s.session_id}` },
        { label: "Driver", key: "name" },
        { label: "Vehicle", key: "reg_no" },
        { label: "Station", render: (s) => `${esc(s.station_name)}<div class="sub">Charger #${s.charger_id}, ${num(s.power_kw)} kW</div>` },
        { label: "Started", render: (s) => dt(s.start_time) },
      ], "No cars are charging right now.")}
    </section>`;
}

// ================= STATIONS =================
export async function stations(view, nav) {
  const rows = await api("/admin/stations");
  const form = (s = {}) => openForm({
    title: s.station_id ? `Edit ${s.station_name}` : "Add a station",
    fields: [
      { name: "station_name", label: "Station name", value: s.station_name, placeholder: "ChargeHub Powai" },
      { name: "address", label: "Address", value: s.address },
      { name: "city", label: "City", value: s.city },
      { name: "operator", label: "Operator", value: s.operator, required: false },
    ],
    submitLabel: s.station_id ? "Save changes" : "Add station",
    onSubmit: async (v) => {
      await api(s.station_id ? `/admin/stations/${s.station_id}` : "/admin/stations", { method: s.station_id ? "PUT" : "POST", body: v });
      toast(s.station_id ? "Station updated" : "Station added"); nav.refresh();
    },
  });
  view.innerHTML = `${head("Stations", "Deleting a station also deletes its chargers (ON DELETE CASCADE), unless they have bookings or sessions.", `<button class="btn btn-primary" id="add">Add station</button>`)}
    ${table(rows, [
      { label: "ID", key: "station_id" },
      { label: "Station", render: (s) => `${esc(s.station_name)}<div class="sub">${esc(s.address)}</div>` },
      { label: "City", key: "city" },
      { label: "Operator", key: "operator" },
      { label: "Chargers", num: true, render: (s) => `${s.available ?? 0} free of ${s.chargers}` },
      { label: "", render: (s) => `<div class="actions"><button class="btn btn-sm" data-edit="${s.station_id}">Edit</button><button class="btn btn-sm btn-danger" data-del="${s.station_id}">Delete</button></div>` },
    ])}`;
  view.querySelector("#add").onclick = () => form();
  view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => form(rows.find((s) => s.station_id == b.dataset.edit))));
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => remove(`/admin/stations/${b.dataset.del}`, `station #${b.dataset.del}`, nav)));
}

// ================= CHARGERS =================
export async function chargers(view, nav) {
  const [rows, stationList, tariffs] = await Promise.all([api("/admin/chargers"), api("/admin/stations"), api("/admin/tariffs")]);
  const form = (c = {}) => openForm({
    title: c.charger_id ? `Edit charger #${c.charger_id}` : "Add a charger",
    fields: [
      { name: "station_id", label: "Station", type: "select", value: c.station_id, options: stationList.map((s) => ({ value: s.station_id, label: s.station_name })) },
      { name: "charger_type", label: "Type", type: "select", value: c.charger_type || "DC", options: [{ value: "AC", label: "AC" }, { value: "DC", label: "DC" }] },
      { name: "tariff_id", label: "Tariff", type: "select", value: c.tariff_id, options: tariffs.map((t) => ({ value: t.tariff_id, label: `${t.tariff_name} (${t.charger_type}, ${money(t.rate_per_kwh)}/kWh)` })), hint: "Must match the charger type." },
      { name: "power_kw", label: "Power (kW)", type: "number", step: "0.1", min: "1", value: c.power_kw },
      { name: "connector_type", label: "Connector", type: "select", value: c.connector_type || "CCS2", options: ["CCS2", "Type 2", "CHAdeMO", "GB/T", "Bharat AC-001"].map((x) => ({ value: x, label: x })) },
    ],
    submitLabel: c.charger_id ? "Save changes" : "Add charger",
    onSubmit: async (v) => {
      await api(c.charger_id ? `/admin/chargers/${c.charger_id}` : "/admin/chargers", { method: c.charger_id ? "PUT" : "POST", body: v });
      toast(c.charger_id ? "Charger updated" : "Charger added"); nav.refresh();
    },
  });
  view.innerHTML = `${head("Chargers", "Busy is set automatically by the session triggers. You can switch a charger between Available and Out of Service.", `<button class="btn btn-primary" id="add">Add charger</button>`)}
    ${table(rows, [
      { label: "ID", key: "charger_id" },
      { label: "Station", render: (c) => `${esc(c.station_name)}<div class="sub">${esc(c.city)}</div>` },
      { label: "Charger", render: (c) => `${esc(c.charger_type)} ${num(c.power_kw)} kW<div class="sub">${esc(c.connector_type)}</div>` },
      { label: "Tariff", render: (c) => `${esc(c.tariff_name)}<div class="sub">${money(c.rate_per_kwh)}/kWh</div>` },
      { label: "Usage", num: true, render: (c) => `${plural(c.sessions, "session")}<div class="sub">${num(c.energy_kwh)} kWh</div>` },
      { label: "Status", render: (c) => badge(c.status) },
      { label: "", render: (c) => `<div class="actions">
          ${c.status === "Available" ? `<button class="btn btn-sm" data-status="${c.charger_id}" data-to="Out of Service">Take offline</button>` : ""}
          ${c.status === "Out of Service" ? `<button class="btn btn-sm" data-status="${c.charger_id}" data-to="Available">Bring online</button>` : ""}
          <button class="btn btn-sm" data-edit="${c.charger_id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del="${c.charger_id}">Delete</button></div>` },
    ])}`;
  view.querySelector("#add").onclick = () => form();
  view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => form(rows.find((c) => c.charger_id == b.dataset.edit))));
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => remove(`/admin/chargers/${b.dataset.del}`, `charger #${b.dataset.del}`, nav)));
  view.querySelectorAll("[data-status]").forEach((b) => (b.onclick = async () => {
    try {
      await api(`/admin/chargers/${b.dataset.status}/status`, { method: "PATCH", body: { status: b.dataset.to } });
      toast(`Charger #${b.dataset.status} is now ${b.dataset.to}`); nav.refresh();
    } catch (err) { toastError(err); }
  }));
}

// ================= TARIFFS =================
export async function tariffs(view, nav) {
  const rows = await api("/admin/tariffs");
  const form = (t = {}) => openForm({
    title: t.tariff_id ? `Edit ${t.tariff_name}` : "Add a tariff",
    fields: [
      { name: "tariff_name", label: "Tariff name", value: t.tariff_name, placeholder: "DC Night Saver" },
      { name: "charger_type", label: "For charger type", type: "select", value: t.charger_type || "DC", options: [{ value: "AC", label: "AC" }, { value: "DC", label: "DC" }] },
      { name: "rate_per_kwh", label: "Rate (₹ per kWh)", type: "number", step: "0.01", min: "0.01", value: t.rate_per_kwh },
    ],
    submitLabel: t.tariff_id ? "Save changes" : "Add tariff",
    onSubmit: async (v) => {
      await api(t.tariff_id ? `/admin/tariffs/${t.tariff_id}` : "/admin/tariffs", { method: t.tariff_id ? "PUT" : "POST", body: v });
      toast(t.tariff_id ? "Tariff updated" : "Tariff added"); nav.refresh();
    },
  });
  view.innerHTML = `${head("Tariffs", "Session cost is calculated by trg_session_cost using the charger's tariff rate.", `<button class="btn btn-primary" id="add">Add tariff</button>`)}
    ${table(rows, [
      { label: "ID", key: "tariff_id" },
      { label: "Tariff", key: "tariff_name" },
      { label: "Type", key: "charger_type" },
      { label: "Rate", num: true, render: (t) => `${money(t.rate_per_kwh)}/kWh` },
      { label: "Chargers using it", key: "chargers", num: true },
      { label: "", render: (t) => `<div class="actions"><button class="btn btn-sm" data-edit="${t.tariff_id}">Edit</button><button class="btn btn-sm btn-danger" data-del="${t.tariff_id}">Delete</button></div>` },
    ])}`;
  view.querySelector("#add").onclick = () => form();
  view.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => form(rows.find((t) => t.tariff_id == b.dataset.edit))));
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => remove(`/admin/tariffs/${b.dataset.del}`, `tariff #${b.dataset.del}`, nav)));
}

// ================= USERS =================
export async function users(view, nav) {
  const rows = await api("/admin/users");
  view.innerHTML = `${head("Users", "Drivers sign up from the login page. A user with vehicles or bookings can't be deleted (ON DELETE RESTRICT).")}
    ${table(rows, [
      { label: "ID", key: "user_id" },
      { label: "Name", render: (u) => `${esc(u.name)}<div class="sub">${esc(u.email)}</div>` },
      { label: "Phone", key: "phone" },
      { label: "City", key: "city" },
      { label: "Joined", render: (u) => dt(u.registration_date) },
      { label: "Vehicles", key: "vehicles", num: true },
      { label: "Bookings", key: "bookings", num: true },
      { label: "Paid", num: true, render: (u) => money(u.total_paid) },
      { label: "", render: (u) => `<button class="btn btn-sm btn-danger" data-del="${u.user_id}">Delete</button>` },
    ])}`;
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => remove(`/admin/users/${b.dataset.del}`, `user #${b.dataset.del}`, nav)));
}

// ================= ACTIVITY =================
export async function bookings(view) {
  const rows = await api("/admin/bookings");
  view.innerHTML = `${head("Bookings", "Every booking, joined with the user, charger and station (INNER JOIN).")}
    ${table(rows, [
      { label: "ID", render: (b) => `#${b.booking_id}` },
      { label: "Driver", key: "name" },
      { label: "Station", render: (b) => `${esc(b.station_name)}<div class="sub">Charger #${b.charger_id}, ${esc(b.charger_type)}</div>` },
      { label: "Booked on", render: (b) => dt(b.booking_date) },
      { label: "Slot", render: (b) => `${dt(b.slot_start)} to ${String(b.slot_end).slice(11, 16)}` },
      { label: "Status", render: (b) => badge(b.status) },
    ])}`;
}

export async function sessions(view) {
  const rows = await api("/admin/sessions");
  const draw = (walkIn) => {
    const list = walkIn ? rows.filter((s) => !s.booking_id) : rows;
    view.querySelector("#list").innerHTML = table(list, [
      { label: "ID", render: (s) => `#${s.session_id}` },
      { label: "Driver", render: (s) => `${esc(s.name)}<div class="sub">${esc(s.reg_no)}</div>` },
      { label: "Station", render: (s) => `${esc(s.station_name)}<div class="sub">Charger #${s.charger_id}</div>` },
      { label: "Booking", render: (s) => (s.booking_id ? `#${s.booking_id}` : `<span class="sub">Walk-in</span>`) },
      { label: "Started", render: (s) => dt(s.start_time) },
      { label: "Energy", num: true, render: (s) => (s.end_time ? `${num(s.energy_kwh)} kWh` : badge("Charging")) },
      { label: "Cost", num: true, render: (s) => (s.end_time ? money(s.cost) : "") },
    ], walkIn ? "No walk-in sessions." : "No sessions yet.");
  };
  view.innerHTML = `${head("Charging sessions", "Walk-ins are sessions with no booking (booking_id is NULL).")}
    <div class="filters"><label class="check"><input type="checkbox" id="walk"> Walk-ins only</label></div><div id="list"></div>`;
  view.querySelector("#walk").onchange = (e) => draw(e.target.checked);
  draw(false);
}

export async function payments(view) {
  const rows = await api("/admin/payments");
  view.innerHTML = `${head("Payments", "Payments are created automatically by trg_session_end when a session stops.")}
    ${table(rows, [
      { label: "ID", render: (p) => `#${p.payment_id}` },
      { label: "Driver", render: (p) => `${esc(p.name)}<div class="sub">${esc(p.reg_no)}</div>` },
      { label: "Station", key: "station_name" },
      { label: "Session", render: (p) => `#${p.session_id}` },
      { label: "Amount", num: true, render: (p) => money(p.amount) },
      { label: "Method", key: "mode" },
      { label: "Date", render: (p) => dt(p.payment_date) },
      { label: "Status", render: (p) => badge(p.status) },
    ])}`;
}

// ================= SQL REPORTS (views + joins) =================
export async function reports(view) {
  const list = await api("/admin/reports");
  const views = list.filter((r) => r.kind === "View"), joins = list.filter((r) => r.kind !== "View");
  const btn = (r) => `<button class="report-btn" data-key="${r.key}"><span>${esc(r.title)}</span><span class="sub">${esc(r.kind)}</span></button>`;
  view.innerHTML = `${head("SQL reports", "Each report runs live against MySQL. Pick one to see the SQL and its result.")}
    <div class="reports">
      <nav class="report-list" aria-label="Reports"><h3>Views</h3>${views.map(btn).join("")}<h3>Joins</h3>${joins.map(btn).join("")}</nav>
      <section id="report" class="stack"></section>
    </div>`;
  const show = async (key) => {
    view.querySelectorAll(".report-btn").forEach((b) => b.setAttribute("aria-current", String(b.dataset.key === key)));
    const box = view.querySelector("#report");
    box.innerHTML = `<p class="sub">Running…</p>`;
    try {
      const r = await api(`/admin/reports/${key}`);
      box.innerHTML = `
        <div><h2>${esc(r.title)}</h2><p class="sub" style="margin-top:4px">${esc(r.purpose)}</p></div>
        ${r.definition ? `<div class="stack" style="gap:6px"><h3>View definition</h3>${sql(r.definition)}</div>` : ""}
        <div class="stack" style="gap:6px"><h3>${r.definition ? "Query" : "SQL"}</h3>${sql(r.sql + ";")}</div>
        <div class="stack" style="gap:6px"><h3>Result (${r.rows.length} row${r.rows.length === 1 ? "" : "s"})</h3>${resultTable(r.columns, r.rows)}</div>`;
    } catch (err) { box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
  };
  view.querySelectorAll(".report-btn").forEach((b) => (b.onclick = () => show(b.dataset.key)));
  show(list[0].key);
}

// ================= TRIGGERS =================
export async function triggers(view) {
  const rows = await api("/admin/triggers");
  view.innerHTML = `${head("Triggers", "Read from information_schema.TRIGGERS. These run inside MySQL whenever the app books, starts or stops a session.")}
    <div class="panel">${rows.map((t) => `
      <article class="trigger">
        <div><h2>${esc(t.name)}</h2><p class="sub" style="margin-top:4px">${esc(t.timing)} ${esc(t.event)} on ${esc(t.table_name)}</p></div>
        ${t.purpose ? `<p>${esc(t.purpose)}</p>` : ""}
        ${sql(t.body)}
      </article>`).join("") || `<div class="empty">No triggers found. Run npm run setup-db to create them.</div>`}</div>`;
}

// ================= SQL CONSOLE =================
const EXAMPLES = [
  "SELECT * FROM v_charger_availability",
  "SELECT * FROM v_station_revenue",
  "SHOW TABLES",
  "DESCRIBE charging_session",
  "SELECT c.charger_id, cs.station_name, COUNT(s.session_id) AS sessions FROM charger c JOIN charging_station cs ON c.station_id = cs.station_id LEFT JOIN charging_session s ON s.charger_id = c.charger_id GROUP BY c.charger_id, cs.station_name",
];

export async function sqlConsole(view) {
  view.innerHTML = `${head("SQL console", "Run read-only queries (SELECT, SHOW, DESCRIBE, EXPLAIN) against ev_charging_db.")}
    <form id="sqlf" class="stack">
      <label>Query<textarea name="sql" rows="6" spellcheck="false">SELECT * FROM v_user_charging_history</textarea></label>
      <div class="chips">${EXAMPLES.map((e, i) => `<button type="button" class="chip" data-ex="${i}">${esc(e.length > 46 ? e.slice(0, 44) + "…" : e)}</button>`).join("")}</div>
      <div class="actions"><button class="btn btn-primary" type="submit">Run query</button></div>
    </form>
    <section class="section" id="out"></section>`;
  const form = view.querySelector("#sqlf"), out = view.querySelector("#out"), ta = form.querySelector("textarea");
  view.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => { ta.value = EXAMPLES[b.dataset.ex]; form.requestSubmit(); }));
  ta.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") form.requestSubmit(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    out.innerHTML = `<p class="sub">Running…</p>`;
    try {
      const r = await api("/admin/sql", { method: "POST", body: { sql: ta.value } });
      out.innerHTML = `<p class="sub" style="margin-bottom:10px">${r.total} row${r.total === 1 ? "" : "s"} in ${r.ms} ms${r.total > r.rows.length ? `, showing the first ${r.rows.length}` : ""}</p>${resultTable(r.columns, r.rows)}`;
    } catch (err) {
      out.innerHTML = `<div class="panel panel-pad"><p class="form-error">${esc(err.message)}</p></div>`;
    }
  };
  form.requestSubmit();
}
