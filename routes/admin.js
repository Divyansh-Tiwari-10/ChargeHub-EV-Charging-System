// Admin panel API: dashboard numbers, managing stations/chargers/tariffs/users,
// all bookings/sessions/payments, SQL reports (views + joins), triggers and a read-only SQL console.
const router = require("express").Router();
const { query } = require("../config/db");
const { AppError, ah } = require("../middleware/errors");
const { requireAdmin } = require("../middleware/auth");
const { REPORTS, TRIGGER_NOTES } = require("./reports-data");

router.use(requireAdmin);

// ---------- dashboard ----------
router.get("/stats", ah(async (req, res) => {
  const [totals] = await query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM vehicle) AS vehicles,
      (SELECT COUNT(*) FROM charging_station) AS stations,
      (SELECT COUNT(*) FROM charger) AS chargers,
      (SELECT COUNT(*) FROM charger WHERE status = 'Available') AS chargers_available,
      (SELECT COUNT(*) FROM charger WHERE status = 'Busy') AS chargers_busy,
      (SELECT COUNT(*) FROM charger WHERE status = 'Out of Service') AS chargers_down,
      (SELECT COUNT(*) FROM booking WHERE status = 'Booked') AS upcoming_bookings,
      (SELECT COUNT(*) FROM charging_session) AS sessions,
      (SELECT COUNT(*) FROM charging_session WHERE end_time IS NULL) AS active_sessions,
      (SELECT IFNULL(SUM(energy_kwh), 0) FROM charging_session) AS energy_kwh,
      (SELECT IFNULL(SUM(amount), 0) FROM payment WHERE status = 'Success') AS revenue,
      (SELECT IFNULL(SUM(amount), 0) FROM payment WHERE status = 'Pending') AS pending_amount`);
  const stationRevenue = await query("SELECT * FROM v_station_revenue ORDER BY revenue DESC");
  const active = await query(`
    SELECT s.session_id, s.start_time, u.name, v.reg_no, cs.station_name, c.charger_id, c.power_kw
    FROM charging_session s
    JOIN vehicle v ON s.vehicle_id = v.vehicle_id
    JOIN users u ON v.user_id = u.user_id
    JOIN charger c ON s.charger_id = c.charger_id
    JOIN charging_station cs ON c.station_id = cs.station_id
    WHERE s.end_time IS NULL ORDER BY s.start_time`);
  res.json({ totals, stationRevenue, active });
}));

// ---------- stations ----------
router.get("/stations", ah(async (req, res) => {
  res.json(await query(`
    SELECT cs.*, COUNT(c.charger_id) AS chargers,
           SUM(c.status = 'Available') AS available
    FROM charging_station cs LEFT JOIN charger c ON c.station_id = cs.station_id
    GROUP BY cs.station_id, cs.station_name, cs.address, cs.city, cs.operator
    ORDER BY cs.station_id`));
}));

router.post("/stations", ah(async (req, res) => {
  const { station_name, address, city, operator } = clean(req.body);
  if (!station_name || !address || !city) throw new AppError(400, "Name, address and city are required.");
  const r = await query("INSERT INTO charging_station (station_name, address, city, operator) VALUES (?, ?, ?, ?)",
    [station_name, address, city, operator || null]);
  res.status(201).json({ station_id: r.insertId });
}));

router.put("/stations/:id", ah(async (req, res) => {
  const { station_name, address, city, operator } = clean(req.body);
  if (!station_name || !address || !city) throw new AppError(400, "Name, address and city are required.");
  await query("UPDATE charging_station SET station_name = ?, address = ?, city = ?, operator = ? WHERE station_id = ?",
    [station_name, address, city, operator || null, req.params.id]);
  res.json({ ok: true });
}));

router.delete("/stations/:id", ah(async (req, res) => {
  // ON DELETE CASCADE removes the station's chargers, unless they have bookings or sessions (RESTRICT).
  await query("DELETE FROM charging_station WHERE station_id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- chargers ----------
router.get("/chargers", ah(async (req, res) => {
  res.json(await query(`
    SELECT c.*, cs.station_name, cs.city, t.tariff_name, t.rate_per_kwh,
           COUNT(s.session_id) AS sessions, IFNULL(SUM(s.energy_kwh), 0) AS energy_kwh
    FROM charger c
    JOIN charging_station cs     ON c.station_id = cs.station_id
    JOIN tariff t                ON c.tariff_id  = t.tariff_id
    LEFT JOIN charging_session s ON s.charger_id = c.charger_id
    GROUP BY c.charger_id, c.station_id, c.tariff_id, c.charger_type, c.power_kw, c.connector_type,
             c.status, cs.station_name, cs.city, t.tariff_name, t.rate_per_kwh
    ORDER BY c.charger_id`));
}));

async function checkCharger(body) {
  const b = clean(body);
  if (!b.station_id || !b.tariff_id || !b.charger_type || !b.power_kw || !b.connector_type) {
    throw new AppError(400, "Station, tariff, type, power and connector are required.");
  }
  const [tariff] = await query("SELECT charger_type FROM tariff WHERE tariff_id = ?", [b.tariff_id]);
  if (tariff && tariff.charger_type !== b.charger_type) {
    throw new AppError(400, `That tariff is for ${tariff.charger_type} chargers. Pick a ${b.charger_type} tariff.`);
  }
  return b;
}

router.post("/chargers", ah(async (req, res) => {
  const b = await checkCharger(req.body);
  const status = b.status === "Out of Service" ? "Out of Service" : "Available";
  const r = await query(
    "INSERT INTO charger (station_id, tariff_id, charger_type, power_kw, connector_type, status) VALUES (?, ?, ?, ?, ?, ?)",
    [b.station_id, b.tariff_id, b.charger_type, b.power_kw, b.connector_type, status]);
  res.status(201).json({ charger_id: r.insertId });
}));

router.put("/chargers/:id", ah(async (req, res) => {
  const b = await checkCharger(req.body);
  await query(
    "UPDATE charger SET station_id = ?, tariff_id = ?, charger_type = ?, power_kw = ?, connector_type = ? WHERE charger_id = ?",
    [b.station_id, b.tariff_id, b.charger_type, b.power_kw, b.connector_type, req.params.id]);
  res.json({ ok: true });
}));

router.patch("/chargers/:id/status", ah(async (req, res) => {
  const status = req.body.status;
  if (!["Available", "Out of Service"].includes(status)) {
    throw new AppError(400, "Chargers can be set to Available or Out of Service. Busy is set by the session triggers.");
  }
  const [c] = await query("SELECT status FROM charger WHERE charger_id = ?", [req.params.id]);
  if (!c) throw new AppError(404, "Charger not found.");
  if (c.status === "Busy") throw new AppError(409, "This charger is in use. Wait for the session to end.");
  await query("UPDATE charger SET status = ? WHERE charger_id = ?", [status, req.params.id]);
  res.json({ ok: true });
}));

router.delete("/chargers/:id", ah(async (req, res) => {
  await query("DELETE FROM charger WHERE charger_id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- tariffs ----------
router.get("/tariffs", ah(async (req, res) => {
  res.json(await query(`
    SELECT t.*, COUNT(c.charger_id) AS chargers
    FROM tariff t LEFT JOIN charger c ON c.tariff_id = t.tariff_id
    GROUP BY t.tariff_id, t.tariff_name, t.charger_type, t.rate_per_kwh ORDER BY t.tariff_id`));
}));

router.post("/tariffs", ah(async (req, res) => {
  const { tariff_name, charger_type, rate_per_kwh } = clean(req.body);
  if (!tariff_name || !charger_type || !rate_per_kwh) throw new AppError(400, "Name, charger type and rate are required.");
  const r = await query("INSERT INTO tariff (tariff_name, charger_type, rate_per_kwh) VALUES (?, ?, ?)",
    [tariff_name, charger_type, rate_per_kwh]);
  res.status(201).json({ tariff_id: r.insertId });
}));

router.put("/tariffs/:id", ah(async (req, res) => {
  const { tariff_name, charger_type, rate_per_kwh } = clean(req.body);
  const [used] = await query("SELECT COUNT(*) AS n FROM charger WHERE tariff_id = ? AND charger_type <> ?", [req.params.id, charger_type]);
  if (used.n) throw new AppError(409, `${used.n} charger(s) of the other type use this tariff, so its type can't change.`);
  await query("UPDATE tariff SET tariff_name = ?, charger_type = ?, rate_per_kwh = ? WHERE tariff_id = ?",
    [tariff_name, charger_type, rate_per_kwh, req.params.id]);
  res.json({ ok: true });
}));

router.delete("/tariffs/:id", ah(async (req, res) => {
  await query("DELETE FROM tariff WHERE tariff_id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- users ----------
router.get("/users", ah(async (req, res) => {
  res.json(await query(`
    SELECT u.*,
           (SELECT COUNT(*) FROM vehicle v WHERE v.user_id = u.user_id) AS vehicles,
           (SELECT COUNT(*) FROM booking b WHERE b.user_id = u.user_id) AS bookings,
           (SELECT IFNULL(SUM(p.amount), 0) FROM payment p
              JOIN charging_session s ON p.session_id = s.session_id
              JOIN vehicle v ON s.vehicle_id = v.vehicle_id
             WHERE v.user_id = u.user_id AND p.status = 'Success') AS total_paid
    FROM users u ORDER BY u.user_id`));
}));

router.delete("/users/:id", ah(async (req, res) => {
  await query("DELETE FROM users WHERE user_id = ?", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- bookings, sessions, payments ----------
router.get("/bookings", ah(async (req, res) => {
  res.json(await query(`
    SELECT b.booking_id, u.name, cs.station_name, c.charger_id, c.charger_type,
           b.booking_date, b.slot_start, b.slot_end, b.status
    FROM booking b
    INNER JOIN users u             ON b.user_id    = u.user_id
    INNER JOIN charger c           ON b.charger_id = c.charger_id
    INNER JOIN charging_station cs ON c.station_id = cs.station_id
    ORDER BY b.booking_id DESC`));
}));

router.get("/sessions", ah(async (req, res) => {
  res.json(await query(`
    SELECT s.session_id, u.name, v.reg_no, cs.station_name, c.charger_id, s.booking_id,
           s.start_time, s.end_time, s.energy_kwh, s.cost
    FROM charging_session s
    JOIN vehicle v           ON s.vehicle_id = v.vehicle_id
    JOIN users u             ON v.user_id    = u.user_id
    JOIN charger c           ON s.charger_id = c.charger_id
    JOIN charging_station cs ON c.station_id = cs.station_id
    ORDER BY s.session_id DESC`));
}));

router.get("/payments", ah(async (req, res) => {
  res.json(await query(`
    SELECT p.*, u.name, v.reg_no, cs.station_name
    FROM payment p
    JOIN charging_session s  ON p.session_id = s.session_id
    JOIN vehicle v           ON s.vehicle_id = v.vehicle_id
    JOIN users u             ON v.user_id    = u.user_id
    JOIN charger c           ON s.charger_id = c.charger_id
    JOIN charging_station cs ON c.station_id = cs.station_id
    ORDER BY p.payment_id DESC`));
}));

// ---------- SQL reports: views and joins ----------
router.get("/reports", (req, res) => {
  res.json(REPORTS.map(({ key, kind, title, purpose }) => ({ key, kind, title, purpose })));
});

router.get("/reports/:key", ah(async (req, res) => {
  const report = REPORTS.find((r) => r.key === req.params.key);
  if (!report) throw new AppError(404, "Report not found.");
  const [rows, fields] = await require("../config/db").pool.query(report.sql);
  res.json({ ...report, columns: fields.map((f) => f.name), rows });
}));

router.get("/triggers", ah(async (req, res) => {
  const rows = await query(`
    SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event,
           EVENT_OBJECT_TABLE AS table_name, ACTION_STATEMENT AS body
    FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
    ORDER BY EVENT_OBJECT_TABLE, EVENT_MANIPULATION, FIELD(ACTION_TIMING, 'BEFORE', 'AFTER')`);
  res.json(rows.map((r) => ({ ...r, purpose: (TRIGGER_NOTES.find((t) => t.name === r.name) || {}).purpose })));
}));

// ---------- read-only SQL console (for the viva demo) ----------
router.post("/sql", ah(async (req, res) => {
  let sql = String(req.body.sql || "").trim().replace(/;\s*$/, "");
  if (!sql) throw new AppError(400, "Type a query first.");
  if (sql.includes(";")) throw new AppError(400, "Run one statement at a time.");
  // WITH can prefix UPDATE/DELETE statements in MySQL, so keep the console to
  // statement types whose top-level command is unambiguously read-only.
  if (!/^(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN)\b/i.test(sql)) {
    throw new AppError(400, "The console is read-only. Use SELECT, SHOW, DESCRIBE or EXPLAIN.");
  }
  // MySQL permits file writes inside SELECT, which are outside this console's
  // read-only contract even though the statement starts with SELECT.
  if (/\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(sql)) {
    throw new AppError(400, "Writing query results to files is not allowed.");
  }
  const started = Date.now();
  const [rows, fields] = await require("../config/db").pool.query(sql);
  const list = Array.isArray(rows) ? rows : [];
  res.json({
    columns: (fields || []).map((f) => f.name),
    rows: list.slice(0, 500),
    total: list.length,
    ms: Date.now() - started,
  });
}));

// Trim strings and turn empty strings into null.
function clean(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    out[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
  }
  return out;
}

module.exports = router;
