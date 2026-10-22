// Everything a logged-in driver does: vehicles, bookings, charging sessions, payments, history.
// The frontend sends the logged-in user's id in the x-user-id header.
const router = require("express").Router();
const { query, transaction } = require("../config/db");
const { AppError, ah } = require("../middleware/errors");

router.use(ah(async (req, res, next) => {
  const id = Number(req.get("x-user-id"));
  if (!id) throw new AppError(401, "Log in first.");
  const [user] = await query("SELECT * FROM users WHERE user_id = ?", [id]);
  if (!user) throw new AppError(401, "Your account no longer exists. Log in again.");
  req.user = user;
  next();
}));

router.get("/", (req, res) => res.json(req.user));

// ---------- dashboard summary ----------
router.get("/summary", ah(async (req, res) => {
  const uid = req.user.user_id;
  const [s] = await query(`
    SELECT
      (SELECT COUNT(*) FROM vehicle WHERE user_id = ?) AS vehicles,
      (SELECT COUNT(*) FROM booking WHERE user_id = ? AND status = 'Booked') AS upcoming_bookings,
      (SELECT COUNT(*) FROM charging_session s JOIN vehicle v ON s.vehicle_id = v.vehicle_id
        WHERE v.user_id = ? AND s.end_time IS NULL) AS active_sessions,
      (SELECT COUNT(*) FROM charging_session s JOIN vehicle v ON s.vehicle_id = v.vehicle_id
        WHERE v.user_id = ? AND s.end_time IS NOT NULL) AS completed_sessions,
      (SELECT IFNULL(SUM(s.energy_kwh), 0) FROM charging_session s JOIN vehicle v ON s.vehicle_id = v.vehicle_id
        WHERE v.user_id = ?) AS total_energy_kwh,
      (SELECT IFNULL(SUM(p.amount), 0) FROM payment p JOIN charging_session s ON p.session_id = s.session_id
        JOIN vehicle v ON s.vehicle_id = v.vehicle_id WHERE v.user_id = ? AND p.status = 'Success') AS total_paid,
      (SELECT IFNULL(SUM(p.amount), 0) FROM payment p JOIN charging_session s ON p.session_id = s.session_id
        JOIN vehicle v ON s.vehicle_id = v.vehicle_id WHERE v.user_id = ? AND p.status = 'Pending') AS pending_amount`,
    Array(7).fill(uid));
  res.json(s);
}));

// ---------- vehicles ----------
router.get("/vehicles", ah(async (req, res) => {
  res.json(await query(`
    SELECT v.*, COUNT(s.session_id) AS sessions, IFNULL(SUM(s.energy_kwh), 0) AS energy_kwh
    FROM vehicle v LEFT JOIN charging_session s ON s.vehicle_id = v.vehicle_id
    WHERE v.user_id = ?
    GROUP BY v.vehicle_id, v.user_id, v.reg_no, v.model, v.battery_kwh
    ORDER BY v.vehicle_id`, [req.user.user_id]));
}));

router.post("/vehicles", ah(async (req, res) => {
  const reg = String(req.body.reg_no || "").replace(/\s+/g, "").toUpperCase();
  const model = String(req.body.model || "").trim();
  const battery = Number(req.body.battery_kwh);
  if (!reg || !model) throw new AppError(400, "Registration number and model are required.");
  if (!(battery > 0)) throw new AppError(400, "Battery capacity must be more than 0 kWh.");
  const r = await query("INSERT INTO vehicle (user_id, reg_no, model, battery_kwh) VALUES (?, ?, ?, ?)",
    [req.user.user_id, reg, model, battery]);
  res.status(201).json({ vehicle_id: r.insertId });
}));

router.delete("/vehicles/:id", ah(async (req, res) => {
  const r = await query("DELETE FROM vehicle WHERE vehicle_id = ? AND user_id = ?", [req.params.id, req.user.user_id]);
  if (!r.affectedRows) throw new AppError(404, "Vehicle not found.");
  res.json({ ok: true });
}));

// ---------- bookings ----------
router.get("/bookings", ah(async (req, res) => {
  res.json(await query(`
    SELECT b.*, cs.station_name, cs.city, c.charger_type, c.power_kw, c.connector_type,
           c.status AS charger_status, t.rate_per_kwh, s.session_id
    FROM booking b
    JOIN charger c           ON b.charger_id = c.charger_id
    JOIN charging_station cs ON c.station_id = cs.station_id
    JOIN tariff t            ON c.tariff_id  = t.tariff_id
    LEFT JOIN charging_session s ON s.booking_id = b.booking_id
    WHERE b.user_id = ?
    ORDER BY (b.status = 'Booked') DESC, b.slot_start DESC`, [req.user.user_id]));
}));

router.post("/bookings", ah(async (req, res) => {
  const { charger_id, slot_start, slot_end } = req.body;
  if (!charger_id || !slot_start || !slot_end) throw new AppError(400, "Pick a charger, start time and end time.");
  const start = new Date(slot_start), end = new Date(slot_end);
  if (isNaN(start) || isNaN(end)) throw new AppError(400, "Times are not valid.");
  if (end <= start) throw new AppError(400, "End time must be after start time.");
  if (start < Date.now() - 5 * 60 * 1000) throw new AppError(400, "Pick a start time in the future.");
  if (end - start > 4 * 3600 * 1000) throw new AppError(400, "A booking can be at most 4 hours long.");
  // trg_booking_check (BEFORE INSERT) rejects out-of-service chargers and overlapping slots.
  const r = await query(
    "INSERT INTO booking (user_id, charger_id, slot_start, slot_end) VALUES (?, ?, ?, ?)",
    [req.user.user_id, charger_id, toSql(start), toSql(end)]);
  res.status(201).json({ booking_id: r.insertId });
}));

router.patch("/bookings/:id/cancel", ah(async (req, res) => {
  const r = await query(
    "UPDATE booking SET status = 'Cancelled' WHERE booking_id = ? AND user_id = ? AND status = 'Booked'",
    [req.params.id, req.user.user_id]);
  if (!r.affectedRows) throw new AppError(400, "Only upcoming bookings can be cancelled.");
  res.json({ ok: true });
}));

// ---------- charging sessions ----------
router.get("/sessions", ah(async (req, res) => {
  const active = req.query.active === "1" ? "AND s.end_time IS NULL" : "";
  res.json(await query(`
    SELECT s.*, v.reg_no, v.model, v.battery_kwh, c.charger_type, c.power_kw, c.connector_type,
           cs.station_name, cs.city, t.rate_per_kwh, p.payment_id, p.status AS payment_status,
           TIMESTAMPDIFF(SECOND, s.start_time, NOW()) AS elapsed_seconds
    FROM charging_session s
    JOIN vehicle v           ON s.vehicle_id = v.vehicle_id
    JOIN charger c           ON s.charger_id = c.charger_id
    JOIN charging_station cs ON c.station_id = cs.station_id
    JOIN tariff t            ON c.tariff_id  = t.tariff_id
    LEFT JOIN payment p      ON p.session_id = s.session_id
    WHERE v.user_id = ? ${active}
    ORDER BY s.start_time DESC`, [req.user.user_id]));
}));

// Start charging, either from a booking or as a walk-in on a free charger.
router.post("/sessions/start", ah(async (req, res) => {
  const vehicleId = Number(req.body.vehicle_id);
  const bookingId = req.body.booking_id ? Number(req.body.booking_id) : null;
  let chargerId = Number(req.body.charger_id) || null;
  if (!vehicleId) throw new AppError(400, "Pick the vehicle you're charging.");

  const result = await transaction(async (conn) => {
    const [[vehicle]] = await conn.query("SELECT * FROM vehicle WHERE vehicle_id = ? AND user_id = ?", [vehicleId, req.user.user_id]);
    if (!vehicle) throw new AppError(404, "That vehicle isn't on your account.");
    const [[busyVehicle]] = await conn.query(
      "SELECT session_id FROM charging_session WHERE vehicle_id = ? AND end_time IS NULL", [vehicleId]);
    if (busyVehicle) throw new AppError(409, `${vehicle.reg_no} is already charging. Stop that session first.`);

    if (bookingId) {
      const [[booking]] = await conn.query(
        "SELECT * FROM booking WHERE booking_id = ? AND user_id = ? FOR UPDATE", [bookingId, req.user.user_id]);
      if (!booking) throw new AppError(404, "Booking not found.");
      if (booking.status !== "Booked") throw new AppError(400, `This booking is ${booking.status.toLowerCase()}.`);
      chargerId = booking.charger_id;
    }
    if (!chargerId) throw new AppError(400, "Pick a charger.");

    const [[charger]] = await conn.query("SELECT * FROM charger WHERE charger_id = ? FOR UPDATE", [chargerId]);
    if (!charger) throw new AppError(404, "Charger not found.");
    if (charger.status !== "Available") throw new AppError(409, `Charger #${chargerId} is ${charger.status.toLowerCase()} right now.`);

    if (!bookingId) {
      // A walk-in can't take a charger someone else has booked for the next hour.
      const [[clash]] = await conn.query(
        `SELECT booking_id, slot_start FROM booking
         WHERE charger_id = ? AND status = 'Booked'
           AND slot_start < NOW() + INTERVAL 60 MINUTE AND slot_end > NOW()`, [chargerId]);
      if (clash) throw new AppError(409, `Charger #${chargerId} is booked from ${clash.slot_start.slice(11, 16)}. Pick another charger or book a slot.`);
    }

    // trg_session_start (AFTER INSERT) marks the charger Busy.
    const [ins] = await conn.query(
      "INSERT INTO charging_session (vehicle_id, charger_id, booking_id, start_time) VALUES (?, ?, ?, NOW())",
      [vehicleId, chargerId, bookingId]);
    const [[after]] = await conn.query("SELECT status FROM charger WHERE charger_id = ?", [chargerId]);
    return { session_id: ins.insertId, charger_id: chargerId, charger_status: after.status };
  });

  res.status(201).json({
    ...result,
    triggers: [`trg_session_start set charger #${result.charger_id} to ${result.charger_status}`],
  });
}));

// Stop charging: record energy; triggers work out the cost, free the charger and add a payment.
router.post("/sessions/:id/stop", ah(async (req, res) => {
  const energy = Math.round(Number(req.body.energy_kwh) * 100) / 100;
  const [session] = await query(`
    SELECT s.*, v.battery_kwh FROM charging_session s JOIN vehicle v ON s.vehicle_id = v.vehicle_id
    WHERE s.session_id = ? AND v.user_id = ?`, [req.params.id, req.user.user_id]);
  if (!session) throw new AppError(404, "Session not found.");
  if (session.end_time) throw new AppError(400, "This session has already ended.");
  if (!(energy > 0)) throw new AppError(400, "Energy delivered must be more than 0 kWh.");
  if (energy > session.battery_kwh) throw new AppError(400, `Energy can't exceed the battery size (${session.battery_kwh} kWh).`);

  // trg_session_cost (BEFORE UPDATE) sets cost; trg_session_end (AFTER UPDATE) frees the charger,
  // completes the booking and inserts a Pending payment.
  await query(`
    UPDATE charging_session
    SET end_time = GREATEST(NOW(), start_time + INTERVAL 1 MINUTE), energy_kwh = ?
    WHERE session_id = ?`, [energy, session.session_id]);

  const [done] = await query(`
    SELECT s.session_id, s.start_time, s.end_time, s.energy_kwh, s.cost, s.booking_id,
           c.charger_id, c.status AS charger_status, b.status AS booking_status,
           p.payment_id, p.amount, p.status AS payment_status, t.rate_per_kwh
    FROM charging_session s
    JOIN charger c       ON s.charger_id = c.charger_id
    JOIN tariff t        ON c.tariff_id  = t.tariff_id
    LEFT JOIN booking b  ON s.booking_id = b.booking_id
    LEFT JOIN payment p  ON p.session_id = s.session_id
    WHERE s.session_id = ?`, [session.session_id]);

  const triggers = [
    `trg_session_cost set cost = ${done.energy_kwh} kWh × ₹${done.rate_per_kwh} = ₹${done.cost}`,
    `trg_session_end set charger #${done.charger_id} to ${done.charger_status}`,
  ];
  if (done.booking_id) triggers.push(`trg_session_end marked booking #${done.booking_id} ${done.booking_status}`);
  triggers.push(`trg_session_end added payment #${done.payment_id} of ₹${done.amount} (${done.payment_status})`);
  res.json({ ...done, triggers });
}));

// ---------- payments ----------
router.get("/payments", ah(async (req, res) => {
  res.json(await query(`
    SELECT p.*, s.start_time, s.energy_kwh, v.reg_no, cs.station_name
    FROM payment p
    JOIN charging_session s  ON p.session_id = s.session_id
    JOIN vehicle v           ON s.vehicle_id = v.vehicle_id
    JOIN charger c           ON s.charger_id = c.charger_id
    JOIN charging_station cs ON c.station_id = cs.station_id
    WHERE v.user_id = ?
    ORDER BY (p.status = 'Pending') DESC, p.payment_id DESC`, [req.user.user_id]));
}));

router.post("/payments/:id/pay", ah(async (req, res) => {
  const mode = req.body.mode;
  if (!["UPI", "Card", "NetBanking", "Wallet", "Cash"].includes(mode)) throw new AppError(400, "Pick a payment method.");
  const [payment] = await query(`
    SELECT p.payment_id, p.status FROM payment p
    JOIN charging_session s ON p.session_id = s.session_id
    JOIN vehicle v ON s.vehicle_id = v.vehicle_id
    WHERE p.payment_id = ? AND v.user_id = ?`, [req.params.id, req.user.user_id]);
  if (!payment) throw new AppError(404, "Payment not found.");
  if (payment.status === "Success") throw new AppError(400, "This payment is already paid.");
  await query("UPDATE payment SET status = 'Success', mode = ?, payment_date = CURRENT_DATE WHERE payment_id = ?",
    [mode, payment.payment_id]);
  res.json({ ok: true });
}));

// ---------- history (v_user_charging_history view) ----------
router.get("/history", ah(async (req, res) => {
  res.json(await query(
    "SELECT * FROM v_user_charging_history WHERE user_id = ? ORDER BY start_time DESC", [req.user.user_id]));
}));

function toSql(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

module.exports = router;
