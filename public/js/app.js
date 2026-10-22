// App entry: login screen, navigation and hash-based routing.
import { api } from "./api.js";
import { session } from "./session.js";
import { esc, toastError } from "./ui.js";
import * as driver from "./driver.js";
import * as admin from "./admin.js";

const ROUTES = {
  driver: [
    { group: "Charging", items: [
      { path: "home", label: "Home", render: driver.home },
      { path: "find", label: "Find a charger", render: driver.find },
      { path: "bookings", label: "My bookings", render: driver.bookings },
    ] },
    { group: "Account", items: [
      { path: "vehicles", label: "My vehicles", render: driver.vehicles },
      { path: "payments", label: "Payments", render: driver.payments, count: "pending" },
      { path: "history", label: "Charging history", render: driver.history },
    ] },
  ],
  admin: [
    { group: "Overview", items: [{ path: "dashboard", label: "Dashboard", render: admin.dashboard }] },
    { group: "Manage", items: [
      { path: "stations", label: "Stations", render: admin.stations },
      { path: "chargers", label: "Chargers", render: admin.chargers },
      { path: "tariffs", label: "Tariffs", render: admin.tariffs },
      { path: "users", label: "Users", render: admin.users },
    ] },
    { group: "Activity", items: [
      { path: "bookings", label: "Bookings", render: admin.bookings },
      { path: "sessions", label: "Charging sessions", render: admin.sessions },
      { path: "payments", label: "Payments", render: admin.payments },
    ] },
    { group: "Database", items: [
      { path: "reports", label: "SQL reports", render: admin.reports },
      { path: "triggers", label: "Triggers", render: admin.triggers },
      { path: "console", label: "SQL console", render: admin.sqlConsole },
    ] },
  ],
};

const view = document.getElementById("view");

function allRoutes(role) { return ROUTES[role].flatMap((g) => g.items); }

async function router() {
  const s = session.get();
  if (!s) return showLogin();
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;

  const routes = allRoutes(s.role);
  const path = location.hash.replace(/^#\/?/, "").split("?")[0] || routes[0].path;
  const route = routes.find((r) => r.path === path) || routes[0];
  renderNav(s, route.path);
  view.innerHTML = `<p class="sub">Loading…</p>`;
  try {
    await route.render(view, { refresh: router, go: (p) => { location.hash = `#/${p}`; } });
  } catch (err) {
    view.innerHTML = `<div class="panel"><div class="empty"><strong>This page couldn't load.</strong><span>${esc(err.message)}</span><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
  view.focus({ preventScroll: true });
  refreshCounts(s);
}

function renderNav(s, current) {
  document.getElementById("nav").innerHTML = ROUTES[s.role].map((g) => `
    <div class="nav-group">
      <div class="nav-group-title">${esc(g.group)}</div>
      ${g.items.map((i) => `<a class="nav-link" href="#/${i.path}" ${i.path === current ? 'aria-current="page"' : ""}>
        <span>${esc(i.label)}</span>${i.count ? `<span class="nav-count" data-count="${i.count}" hidden></span>` : ""}</a>`).join("")}
    </div>`).join("");
  document.getElementById("who").innerHTML = s.role === "admin"
    ? `<strong>Admin</strong>Station operator`
    : `<strong>${esc(s.user.name)}</strong>${esc(s.user.email)}`;
}

async function refreshCounts(s) {
  if (s.role !== "driver") return;
  try {
    const el = document.querySelector('[data-count="pending"]');
    const n = (await api("/me/payments")).filter((p) => p.status === "Pending").length;
    if (el) { el.textContent = n; el.hidden = !n; }
  } catch { /* counts are optional */ }
}

// ---------- login screen ----------
function showLogin() {
  document.getElementById("app").hidden = true;
  document.getElementById("login").hidden = false;
  checkDb();
}

async function checkDb() {
  const el = document.getElementById("db-status");
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    if (!h.ok) throw new Error(h.error);
    el.className = "db-status ok";
    el.textContent = `Connected to MySQL ${h.version.split("-")[0]}, database ${h.db}`;
  } catch (err) {
    el.className = "db-status bad";
    el.textContent = `Database not connected: ${err.message}. Check .env and run npm run setup-db.`;
  }
}

function showPanel(name) {
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === (name === "register" ? "driver" : name))));
  document.querySelector(`[data-panel="${name}"] input`)?.focus();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showPanel(t.dataset.tab)));
document.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => showPanel(b.dataset.show)));

function bindForm(id, handler) {
  const form = document.getElementById(id);
  const err = form.querySelector(".form-error");
  form.addEventListener("input", () => { err.textContent = ""; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
      form.reset();
      location.hash = "";
      router();
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
    }
  };
}

bindForm("driver-login", async (v) => {
  const user = await api("/auth/login", { method: "POST", body: v });
  session.set({ role: "driver", user });
});
bindForm("driver-register", async (v) => {
  const user = await api("/auth/register", { method: "POST", body: v });
  session.set({ role: "driver", user });
});
bindForm("admin-login", async (v) => {
  await api("/auth/admin", { method: "POST", body: v });
  session.set({ role: "admin", key: v.password });
});

document.getElementById("logout").onclick = () => { session.clear(); location.hash = ""; showLogin(); };
window.addEventListener("hashchange", router);
window.addEventListener("unhandledrejection", (e) => { if (e.reason?.message) toastError(e.reason); });
router();
