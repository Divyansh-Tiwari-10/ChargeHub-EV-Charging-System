// Read-only data anyone can see: stations with their chargers, availability and tariffs.
const router = require("express").Router();
const { query } = require("../config/db");
const { ah } = require("../middleware/errors");

// Stations, each with its list of chargers (JOIN charging_station + charger + tariff).
router.get("/stations", ah(async (req, res) => {
  const rows = await query(`
    SELECT cs.station_id, cs.station_name, cs.address, cs.city, cs.operator,
           c.charger_id, c.charger_type, c.power_kw, c.connector_type, c.status,
           t.tariff_id, t.tariff_name, t.rate_per_kwh
    FROM charging_station cs
    LEFT JOIN charger c ON c.station_id = cs.station_id
    LEFT JOIN tariff t  ON c.tariff_id  = t.tariff_id
    ORDER BY cs.city, cs.station_name, c.charger_id`);
  const stations = new Map();
  for (const r of rows) {
    if (!stations.has(r.station_id)) {
      stations.set(r.station_id, {
        station_id: r.station_id, station_name: r.station_name, address: r.address,
        city: r.city, operator: r.operator, chargers: [],
      });
    }
    if (r.charger_id) {
      stations.get(r.station_id).chargers.push({
        charger_id: r.charger_id, charger_type: r.charger_type, power_kw: r.power_kw,
        connector_type: r.connector_type, status: r.status, tariff_id: r.tariff_id,
        tariff_name: r.tariff_name, rate_per_kwh: r.rate_per_kwh,
      });
    }
  }
  res.json([...stations.values()]);
}));

// Uses the v_charger_availability view.
router.get("/chargers/available", ah(async (req, res) => {
  res.json(await query("SELECT * FROM v_charger_availability WHERE status = 'Available' ORDER BY station_name, charger_id"));
}));

// Upcoming bookings on one charger, so drivers can pick a free slot.
router.get("/chargers/:id/bookings", ah(async (req, res) => {
  res.json(await query(
    `SELECT slot_start, slot_end FROM booking
     WHERE charger_id = ? AND status = 'Booked' AND slot_end > NOW()
     ORDER BY slot_start`, [req.params.id]));
}));

router.get("/tariffs", ah(async (req, res) => {
  res.json(await query("SELECT * FROM tariff ORDER BY rate_per_kwh"));
}));

module.exports = router;
