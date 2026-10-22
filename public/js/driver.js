// Driver pages: home (live charging meter), find a charger, bookings, vehicles, payments, history.
import { api } from "./api.js";
import { session } from "./session.js";
import { esc, money, num, dt, time, badge, table, toast, toastError, openForm, confirmDialog } from "./ui.js";

// Demo speed for the simulated meter: 1 real second = 1 minute of charging.
const DEMO_SPEED = 60;
const EFFICIENCY = 0.92;
let meterTimer = null;

const head = (title, text = "", actions = "") =>
  `<div class="page-head"><div><h1>${esc(title)}</h1>${text ? `<p>${text}</p>` : ""}</div>${actions}</div>`;

// ================= HOME =================
export async function home(view, nav) {
  const user = session.get().user;
  const [sum, active, bookings, vehicles] = await Promise.all([
    api("/me/summary"), api("/me/sessions?active=1"), api("/me/bookings"), api("/me/vehicles"),
  ]);
  const upcoming = bookings.filter((b) => b.status === "Booked").slice(0, 3);

  view.innerHTML = `
    ${head(`Hi, ${user.name.split(" ")[0]}`, active.length ? "Your car is charging." : "Ready when you are. Find a free charger or start a booked slot.",
      `<a class="btn btn-primary" href="#/find">Find a charger</a>`)}
    <div id="meters">${active.map(meterHtml).join("")}</div>
    ${!vehicles.length ? `<div class="panel section"><div class="empty"><strong>Add your car to start charging.</strong>
        <span>Sessions are recorded against a vehicle, so you need at least one.</span>
        <a class="btn btn-primary" href="#/vehicles">Add a vehicle</a></div></div>` : ""}
    <div class="figures ${active.length ? "section" : ""}">
      ${fig(sum.completed_sessions, "Charging sessions")}
      ${fig(num(sum.total_energy_kwh) + " kWh", "Energy charged")}
      ${fig(money(sum.total_paid), "Paid so far")}
      ${fig(money(sum.pending_amount), "Waiting to be paid")}
    </div>
    <section class="section">
      <h2>Upcoming bookings</h2>
      ${upcoming.length ? bookingTable(upcoming) : `<div class="panel"><div class="empty">No upcoming bookings. <a href="#/find">Book a charging slot</a></div></div>`}
    </section>`;

  bindBookingActions(view, nav, vehicles);
  startMeters(view, nav);
}

const fig = (v, l) => `<div class="figure"><div class="figure-value">${esc(v)}</div><div class="figure-label">${esc(l)}</div></div>`;

function meterHtml(s) {
  return `
  <section class="meter" data-session="${s.session_id}" data-elapsed="${s.elapsed_seconds}" data-power="${s.power_kw}"
           data-battery="${s.battery_kwh}" data-rate="${s.rate_per_kwh}" data-loaded="${Date.now()}">
    <div class="meter-head">
      <div>
        <span class="meter-live">Charging now</span>
        <h2 style="margin-top:6px">${esc(s.model)} <span class="sub">${esc(s.reg_no)}</span></h2>
        <p class="sub">${esc(s.station_name)}, charger #${s.charger_id}: ${esc(s.charger_type)} ${num(s.power_kw)} kW ${esc(s.connector_type)}, ${money(s.rate_per_kwh)} per kWh</p>
      </div>
      <button class="btn btn-primary" data-stop="${s.session_id}">Stop charging</button>
    </div>
    <div class="battery" aria-hidden="true"><div class="battery-fill"></div></div>
    <div class="meter-figures">
      <div><div class="figure-value" data-k="energy">0.00</div><div class="figure-label">kWh delivered</div></div>
      <div><div class="figure-value" data-k="cost">₹0</div><div class="figure-label">Cost so far</div></div>
      <div><div class="figure-value" data-k="pct">0%</div><div class="figure-label">Battery (est.)</div></div>
      <div><div class="figure-value" data-k="time">0 min</div><div class="figure-label">Charging time</div></div>
    </div>
    <div class="meter-foot">
      <span>Started ${dt(s.start_time)}${s.booking_id ? `, booking #${s.booking_id}` : ", walk-in"}</span>
      <span>Simulated meter: each real second counts as one minute of charging</span>
    </div>
  </section>`;
}

// Simulated reading for a session card (no real charger hardware in this project).
function reading(el) {
  const elapsed = Number(el.dataset.elapsed) + (Date.now() - Number(el.dataset.loaded)) / 1000;
  const minutes = elapsed * DEMO_SPEED / 60;
  const battery = Number(el.dataset.battery);
  const startPct = 20;                                   // assume the car arrives at 20%
  const room = battery * (95 - startPct) / 100;          // and stops at 95%
  const energy = Math.min(Number(el.dataset.power) * (minutes / 60) * EFFICIENCY, room);
  const pct = startPct + (energy / battery) * 100;
  return { minutes, energy: Math.round(energy * 100) / 100, pct, cost: energy * Number(el.dataset.rate) };
}

function startMeters(view, nav) {
  clearInterval(meterTimer);
  const meters = [...view.querySelectorAll(".meter")];
  const tick = () => {
    if (!document.body.contains(meters[0])) return clearInterval(meterTimer);
    for (const el of meters) {
      const r = reading(el);
      const fill = el.querySelector(".battery-fill");
      fill.style.width = `${r.pct.toFixed(1)}%`;
      fill.style.setProperty("--pct", Math.max(r.pct, 1).toFixed(1));
      el.querySelector('[data-k="energy"]').textContent = r.energy.toFixed(2);
      el.querySelector('[data-k="cost"]').textContent = money(r.cost).replace(".00", "");
      el.querySelector('[data-k="pct"]').textContent = `${Math.floor(r.pct)}%`;
      const m = Math.floor(r.minutes);
      el.querySelector('[data-k="time"]').textContent = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    }
  };
  if (meters.length) { tick(); meterTimer = setInterval(tick, 1000); }

  view.querySelectorAll("[data-stop]").forEach((btn) => (btn.onclick = () => {
    const el = btn.closest(".meter");
    const r = reading(el);
    openForm({
      title: "Stop charging",
      intro: `<p class="modal-note">The database works out the bill: <strong>trg_session_cost</strong> multiplies the energy by the tariff, then <strong>trg_session_end</strong> frees the charger and creates the payment.</p>`,
      fields: [{ name: "energy_kwh", label: "Meter reading (kWh delivered)", type: "number", step: "0.01", min: "0.01", max: el.dataset.battery,
        value: Math.max(r.energy, 0.5).toFixed(2), hint: `Filled from the simulated meter. Battery size is ${el.dataset.battery} kWh.` }],
      submitLabel: "Stop and create bill",
      onSubmit: async (v) => {
        const res = await api(`/me/sessions/${btn.dataset.stop}/stop`, { method: "POST", body: v });
        toast(`Charging stopped. Bill: ${money(res.cost)}`, { label: "Fired by the database", details: res.triggers });
        nav.go("payments");
      },
    });
  }));
}

// ================= FIND A CHARGER =================
export async function find(view, nav) {
  const [stations, vehicles] = await Promise.all([api("/stations"), api("/me/vehicles")]);
  const cities = [...new Set(stations.map((s) => s.city))].sort();
  view.innerHTML = `
    ${head("Find a charger", "Green means free now. You can charge straight away on a free charger, or book a slot on any working charger.")}
    <div class="filters">
      <label>City<select id="f-city"><option value="">All cities</option>${cities.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
      <label>Charger type<select id="f-type"><option value="">AC and DC</option><option value="AC">AC (slower, cheaper)</option><option value="DC">DC fast charging</option></select></label>
      <label class="check"><input type="checkbox" id="f-free"> Only free chargers</label>
    </div>
    <div class="panel" id="station-list"></div>`;

  const draw = () => {
    const city = view.querySelector("#f-city").value, type = view.querySelector("#f-type").value, free = view.querySelector("#f-free").checked;
    const list = stations.filter((s) => !city || s.city === city).map((s) => ({
      ...s, chargers: s.chargers.filter((c) => (!type || c.charger_type === type) && (!free || c.status === "Available")),
    })).filter((s) => s.chargers.length);
    view.querySelector("#station-list").innerHTML = list.length ? list.map((s) => `
      <article class="station">
        <div>
          <h3>${esc(s.station_name)}</h3>
          <p class="sub">${esc(s.address)}, ${esc(s.city)}</p>
          <p class="sub">${s.chargers.filter((c) => c.status === "Available").length} of ${s.chargers.length} free${s.operator ? `, run by ${esc(s.operator)}` : ""}</p>
        </div>
        <div class="sockets">${s.chargers.map((c) => `
          <div class="socket" data-status="${esc(c.status)}">
            <div class="socket-top"><span class="socket-power">${esc(c.charger_type)} ${num(c.power_kw)} kW</span>${badge(c.status)}</div>
            <div class="socket-meta">Charger #${c.charger_id}, ${esc(c.connector_type)}, ${money(c.rate_per_kwh)}/kWh</div>
            <div class="actions">
              ${c.status === "Available" ? `<button class="btn btn-primary btn-sm" data-now="${c.charger_id}">Charge now</button>` : ""}
              ${c.status !== "Out of Service" ? `<button class="btn btn-sm" data-book="${c.charger_id}">Book a slot</button>` : `<span class="sub">Under maintenance</span>`}
            </div>
          </div>`).join("")}
        </div>
      </article>`).join("") : `<div class="empty">No chargers match these filters.</div>`;

    view.querySelectorAll("[data-now]").forEach((b) => (b.onclick = () => startDialog(nav, vehicles, { charger_id: b.dataset.now })));
    view.querySelectorAll("[data-book]").forEach((b) => (b.onclick = () => bookDialog(nav, stations, Number(b.dataset.book))));
  };
  view.querySelectorAll("select, input").forEach((el) => (el.onchange = draw));
  draw();
}

function vehicleOptions(vehicles) {
  return vehicles.map((v) => ({ value: v.vehicle_id, label: `${v.model} (${v.reg_no})` }));
}

function startDialog(nav, vehicles, { charger_id, booking_id }) {
  if (!vehicles.length) {
    toast("Add a vehicle before you start charging.", { error: true });
    return nav.go("vehicles");
  }
  openForm({
    title: booking_id ? `Start booking #${booking_id}` : `Charge now on charger #${charger_id}`,
    intro: `<p class="modal-note">Starting inserts a row into charging_session. The <strong>trg_session_start</strong> trigger then marks the charger Busy.</p>`,
    fields: [{ name: "vehicle_id", label: "Vehicle", type: "select", options: vehicleOptions(vehicles) }],
    submitLabel: "Start charging",
    onSubmit: async (v) => {
      const res = await api("/me/sessions/start", { method: "POST", body: { ...v, charger_id, booking_id } });
      toast("Charging started", { label: "Fired by the database", details: res.triggers });
      nav.go("home");
    },
  });
}

async function bookDialog(nav, stations, chargerId) {
  const station = stations.find((s) => s.chargers.some((c) => c.charger_id === chargerId));
  const c = station.chargers.find((x) => x.charger_id === chargerId);
  const taken = await api(`/chargers/${chargerId}/bookings`);
  const now = new Date(Date.now() + 60 * 60 * 1000);
  now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  openForm({
    title: "Book a charging slot",
    intro: `<p><strong>${esc(station.station_name)}</strong>, charger #${c.charger_id}: ${esc(c.charger_type)} ${num(c.power_kw)} kW ${esc(c.connector_type)}, ${money(c.rate_per_kwh)}/kWh</p>
      ${taken.length ? `<p class="hint">Already booked: ${taken.map((t) => `${dt(t.slot_start)} to ${time(t.slot_end)}`).join("; ")}</p>` : `<p class="hint">No other bookings on this charger yet.</p>`}`,
    fields: [
      { name: "date", label: "Date", type: "date", value: day, min: (() => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; })() },
      { name: "start", label: "Start time", type: "time", value: hhmm, step: 900 },
      { name: "duration", label: "How long", type: "select", value: 60, options: [30, 45, 60, 90, 120, 180, 240].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}` })) },
    ],
    submitLabel: "Book slot",
    onSubmit: async (v) => {
      const start = new Date(`${v.date}T${v.start}`);
      const end = new Date(start.getTime() + Number(v.duration) * 60000);
      const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      await api("/me/bookings", { method: "POST", body: { charger_id: chargerId, slot_start: local(start), slot_end: local(end) } });
      toast("Slot booked", { label: "Checked by the database", details: ["trg_booking_check confirmed the charger works and the slot is free"] });
      nav.go("bookings");
    },
  });
}

// ================= BOOKINGS =================
function bookingTable(rows) {
  return table(rows, [
    { label: "Booking", render: (b) => `#${b.booking_id}` },
    { label: "Station and charger", render: (b) => `${esc(b.station_name)}<div class="sub">Charger #${b.charger_id}, ${esc(b.charger_type)} ${num(b.power_kw)} kW</div>` },
    { label: "Slot", render: (b) => `${dt(b.slot_start)} to ${time(b.slot_end)}` },
    { label: "Status", render: (b) => badge(b.status) },
    { label: "", render: (b) => b.status === "Booked"
      ? `<div class="actions"><button class="btn btn-primary btn-sm" data-start-booking="${b.booking_id}">Start charging</button><button class="btn btn-sm btn-danger" data-cancel="${b.booking_id}">Cancel</button></div>`
      : b.session_id ? `<span class="sub">Session #${b.session_id}</span>` : "" },
  ], "No bookings yet.");
}

function bindBookingActions(view, nav, vehicles) {
  view.querySelectorAll("[data-start-booking]").forEach((b) => (b.onclick = () => startDialog(nav, vehicles, { booking_id: b.dataset.startBooking })));
  view.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog("Cancel this booking?", `Booking #${b.dataset.cancel} will be marked Cancelled and the slot freed for others.`, "Cancel booking"))) return;
    try {
      await api(`/me/bookings/${b.dataset.cancel}/cancel`, { method: "PATCH" });
      toast("Booking cancelled");
      nav.refresh();
    } catch (err) { toastError(err); }
  }));
}

export async function bookings(view, nav) {
  const [rows, vehicles] = await Promise.all([api("/me/bookings"), api("/me/vehicles")]);
  view.innerHTML = `${head("My bookings", "Start charging when you reach the station, or cancel to free the slot.", `<a class="btn btn-primary" href="#/find">Book a slot</a>`)}
    ${bookingTable(rows)}`;
  bindBookingActions(view, nav, vehicles);
}

// ================= VEHICLES =================
export async function vehicles(view, nav) {
  const rows = await api("/me/vehicles");
  view.innerHTML = `${head("My vehicles", "Charging sessions are recorded against the car you plug in.", `<button class="btn btn-primary" id="add-vehicle">Add vehicle</button>`)}
    ${table(rows, [
      { label: "Model", key: "model" },
      { label: "Registration", key: "reg_no" },
      { label: "Battery", num: true, render: (v) => `${num(v.battery_kwh)} kWh` },
      { label: "Sessions", key: "sessions", num: true },
      { label: "Energy charged", num: true, render: (v) => `${num(v.energy_kwh)} kWh` },
      { label: "", render: (v) => `<button class="btn btn-sm btn-danger" data-del="${v.vehicle_id}" data-name="${esc(v.reg_no)}">Remove</button>` },
    ], "No vehicles yet. Add your car to start charging.")}`;

  view.querySelector("#add-vehicle").onclick = () => openForm({
    title: "Add a vehicle",
    fields: [
      { name: "model", label: "Model", placeholder: "Tata Nexon EV" },
      { name: "reg_no", label: "Registration number", placeholder: "MH01AB1234", maxlength: 15 },
      { name: "battery_kwh", label: "Battery capacity (kWh)", type: "number", step: "0.1", min: "1", max: "200", placeholder: "40.5" },
    ],
    submitLabel: "Add vehicle",
    onSubmit: async (v) => { await api("/me/vehicles", { method: "POST", body: v }); toast("Vehicle added"); nav.refresh(); },
  });
  view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog("Remove this vehicle?", `${b.dataset.name} will be deleted from your account.`, "Remove vehicle"))) return;
    try { await api(`/me/vehicles/${b.dataset.del}`, { method: "DELETE" }); toast("Vehicle removed"); nav.refresh(); }
    catch (err) { toastError(err); }
  }));
}

// ================= PAYMENTS =================
export async function payments(view, nav) {
  const rows = await api("/me/payments");
  const pending = rows.filter((p) => p.status !== "Success");
  view.innerHTML = `${head("Payments", pending.length ? `${pending.length} bill${pending.length > 1 ? "s" : ""} to pay, ${money(pending.reduce((a, p) => a + p.amount, 0))} in total.` : "All your charging sessions are paid.")}
    ${table(rows, [
      { label: "Payment", render: (p) => `#${p.payment_id}` },
      { label: "Session", render: (p) => `${esc(p.station_name)}<div class="sub">${dt(p.start_time)}, ${esc(p.reg_no)}</div>` },
      { label: "Energy", num: true, render: (p) => `${num(p.energy_kwh)} kWh` },
      { label: "Amount", num: true, render: (p) => money(p.amount) },
      { label: "Method", render: (p) => esc(p.mode || "") },
      { label: "Status", render: (p) => badge(p.status) },
      { label: "", render: (p) => p.status !== "Success" ? `<button class="btn btn-primary btn-sm" data-pay="${p.payment_id}" data-amount="${p.amount}">Pay ${money(p.amount)}</button>` : "" },
    ], "No payments yet. A bill appears here when a charging session ends.")}`;

  view.querySelectorAll("[data-pay]").forEach((b) => (b.onclick = () => openForm({
    title: `Pay ${money(b.dataset.amount)}`,
    intro: `<p class="hint">Payments are simulated. No money changes hands.</p>`,
    fields: [{ name: "mode", label: "Payment method", type: "select", options: ["UPI", "Card", "NetBanking", "Wallet", "Cash"].map((m) => ({ value: m, label: m })) }],
    submitLabel: "Pay now",
    onSubmit: async (v) => { await api(`/me/payments/${b.dataset.pay}/pay`, { method: "POST", body: v }); toast("Payment successful"); nav.refresh(); },
  })));
}

// ================= HISTORY (view) =================
export async function history(view) {
  const rows = await api("/me/history");
  const energy = rows.reduce((a, r) => a + (r.energy_kwh || 0), 0);
  const cost = rows.reduce((a, r) => a + (r.cost || 0), 0);
  view.innerHTML = `${head("Charging history", `Read from the <code>v_user_charging_history</code> view. ${rows.length} sessions, ${num(energy)} kWh, ${money(cost)} in total.`)}
    ${table(rows, [
      { label: "Session", render: (r) => `#${r.session_id}` },
      { label: "Started", render: (r) => dt(r.start_time) },
      { label: "Vehicle", render: (r) => `${esc(r.model)}<div class="sub">${esc(r.reg_no)}</div>` },
      { label: "Station", key: "station_name" },
      { label: "Energy", num: true, render: (r) => (r.end_time ? `${num(r.energy_kwh)} kWh` : badge("Charging")) },
      { label: "Cost", num: true, render: (r) => (r.end_time ? money(r.cost) : "") },
      { label: "Payment", render: (r) => (r.payment_status ? badge(r.payment_status) : "") },
    ], "No charging sessions yet.")}`;
}
