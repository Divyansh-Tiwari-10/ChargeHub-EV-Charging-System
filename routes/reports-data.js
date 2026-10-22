// Views and join queries shown on the SQL reports page. Matches database/schema.sql and database/queries.sql.
const REPORTS = [
  {
    "key": "v_charger_availability",
    "kind": "View",
    "title": "v_charger_availability",
    "purpose": "Shows every charger with its station, power, connector, tariff rate and current status, so a user can see where to charge without writing joins.",
    "definition": "CREATE VIEW v_charger_availability AS\nSELECT cs.station_name, cs.city, c.charger_id, c.charger_type,\n       c.power_kw, c.connector_type, t.rate_per_kwh, c.status\nFROM charger c\nJOIN charging_station cs ON c.station_id = cs.station_id\nJOIN tariff t            ON c.tariff_id  = t.tariff_id;",
    "sql": "SELECT * FROM v_charger_availability WHERE status = 'Available'"
  },
  {
    "key": "v_user_charging_history",
    "kind": "View",
    "title": "v_user_charging_history",
    "purpose": "Combines users, vehicles, sessions, stations and payments into one charging history per user.",
    "definition": "CREATE VIEW v_user_charging_history AS\nSELECT u.user_id, u.name, s.session_id, v.reg_no, v.model, cs.station_name,\n       s.start_time, s.end_time, s.energy_kwh, s.cost, p.status AS payment_status\nFROM users u\nJOIN vehicle v           ON v.user_id    = u.user_id\nJOIN charging_session s  ON s.vehicle_id = v.vehicle_id\nJOIN charger c           ON s.charger_id = c.charger_id\nJOIN charging_station cs ON c.station_id = cs.station_id\nLEFT JOIN payment p      ON p.session_id = s.session_id;",
    "sql": "SELECT * FROM v_user_charging_history ORDER BY start_time"
  },
  {
    "key": "v_station_revenue",
    "kind": "View",
    "title": "v_station_revenue",
    "purpose": "Summarises each station’s number of sessions, energy delivered and revenue from successful payments.",
    "definition": "CREATE VIEW v_station_revenue AS\nSELECT cs.station_name, cs.city,\n       COUNT(s.session_id)          AS total_sessions,\n       IFNULL(SUM(s.energy_kwh), 0) AS total_energy_kwh,\n       IFNULL(SUM(p.amount), 0)     AS revenue\nFROM charging_station cs\nLEFT JOIN charger c          ON c.station_id = cs.station_id\nLEFT JOIN charging_session s ON s.charger_id = c.charger_id\nLEFT JOIN payment p          ON p.session_id = s.session_id\n                            AND p.status = 'Success'\nGROUP BY cs.station_id, cs.station_name, cs.city;",
    "sql": "SELECT * FROM v_station_revenue ORDER BY revenue DESC"
  },
  {
    "key": "booking_details",
    "kind": "INNER JOIN",
    "title": "Booking details",
    "purpose": "Lists each booking with the user’s name and the station and charger type that was booked.",
    "definition": null,
    "sql": "SELECT b.booking_id, u.name, cs.station_name, c.charger_type,\n       b.slot_start, b.status\nFROM booking b\nINNER JOIN users u            ON b.user_id    = u.user_id\nINNER JOIN charger c          ON b.charger_id = c.charger_id\nINNER JOIN charging_station cs ON c.station_id = cs.station_id\nORDER BY b.booking_id"
  },
  {
    "key": "charger_utilisation",
    "kind": "LEFT JOIN",
    "title": "Charger utilisation",
    "purpose": "Shows every charger with its number of sessions and energy delivered, including chargers never used.",
    "definition": null,
    "sql": "SELECT c.charger_id, cs.station_name, c.status,\n       COUNT(s.session_id)          AS sessions,\n       IFNULL(SUM(s.energy_kwh), 0) AS energy_kwh\nFROM charger c\nJOIN charging_station cs     ON c.station_id = cs.station_id\nLEFT JOIN charging_session s ON s.charger_id = c.charger_id\nGROUP BY c.charger_id, cs.station_name, c.status\nORDER BY c.charger_id"
  },
  {
    "key": "walk_in_sessions",
    "kind": "LEFT JOIN with IS NULL",
    "title": "Walk-in sessions",
    "purpose": "Finds sessions that were started without any booking (walk-in customers).",
    "definition": null,
    "sql": "SELECT s.session_id, u.name, v.reg_no, s.start_time, s.cost\nFROM charging_session s\nJOIN vehicle v      ON s.vehicle_id = v.vehicle_id\nJOIN users u        ON v.user_id    = u.user_id\nLEFT JOIN booking b ON s.booking_id = b.booking_id\nWHERE b.booking_id IS NULL"
  },
  {
    "key": "bookings_per_user",
    "kind": "RIGHT JOIN",
    "title": "Bookings per user",
    "purpose": "Counts bookings for every registered user, keeping users who have never booked.",
    "definition": null,
    "sql": "SELECT u.user_id, u.name, COUNT(b.booking_id) AS total_bookings\nFROM booking b\nRIGHT JOIN users u ON b.user_id = u.user_id\nGROUP BY u.user_id, u.name\nORDER BY u.user_id"
  }
];

const TRIGGER_NOTES = [
  {
    "name": "trg_booking_check",
    "event": "BEFORE INSERT on booking",
    "purpose": "Rejects a booking if the charger is out of service or the slot overlaps an existing booking."
  },
  {
    "name": "trg_session_start",
    "event": "AFTER INSERT on charging_session",
    "purpose": "Marks the charger as Busy as soon as a new (ongoing) session starts on it."
  },
  {
    "name": "trg_session_cost",
    "event": "BEFORE UPDATE on charging_session",
    "purpose": "When a session ends, calculates its cost as energy_kwh × the charger’s tariff rate."
  },
  {
    "name": "trg_session_end",
    "event": "AFTER UPDATE on charging_session",
    "purpose": "When a session ends, frees the charger, creates a Pending payment and completes the booking."
  }
];

module.exports = { REPORTS, TRIGGER_NOTES };
