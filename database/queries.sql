-- ChargeHub: EV Charging System (DBMS mini project, MySQL 8.0)
-- Divyansh Tiwari (2025800129), Shreyas Trimbakkar (2025800130), Krishana Tupe (2025800131)
-- Practice queries: views, joins and a trigger walkthrough.
-- Run after schema.sql. The app shows the same queries on its SQL reports page.

USE ev_charging_db;

-- ======================================================================
-- Views
-- ======================================================================
-- Shows every charger with its station, power, connector, tariff rate and current status, so a user can see where to charge without writing joins.
SELECT * FROM v_charger_availability WHERE status = 'Available';

-- Combines users, vehicles, sessions, stations and payments into one charging history per user.
SELECT * FROM v_user_charging_history ORDER BY start_time;

-- Summarises each station’s number of sessions, energy delivered and revenue from successful payments.
SELECT * FROM v_station_revenue ORDER BY revenue DESC;

-- ======================================================================
-- Joins
-- ======================================================================
-- Booking details (INNER JOIN): Lists each booking with the user’s name and the station and charger type that was booked.
SELECT b.booking_id, u.name, cs.station_name, c.charger_type,
       b.slot_start, b.status
FROM booking b
INNER JOIN users u            ON b.user_id    = u.user_id
INNER JOIN charger c          ON b.charger_id = c.charger_id
INNER JOIN charging_station cs ON c.station_id = cs.station_id
ORDER BY b.booking_id;

-- Charger utilisation (LEFT JOIN): Shows every charger with its number of sessions and energy delivered, including chargers never used.
SELECT c.charger_id, cs.station_name, c.status,
       COUNT(s.session_id)          AS sessions,
       IFNULL(SUM(s.energy_kwh), 0) AS energy_kwh
FROM charger c
JOIN charging_station cs     ON c.station_id = cs.station_id
LEFT JOIN charging_session s ON s.charger_id = c.charger_id
GROUP BY c.charger_id, cs.station_name, c.status
ORDER BY c.charger_id;

-- Walk-in sessions (LEFT JOIN with IS NULL): Finds sessions that were started without any booking (walk-in customers).
SELECT s.session_id, u.name, v.reg_no, s.start_time, s.cost
FROM charging_session s
JOIN vehicle v      ON s.vehicle_id = v.vehicle_id
JOIN users u        ON v.user_id    = u.user_id
LEFT JOIN booking b ON s.booking_id = b.booking_id
WHERE b.booking_id IS NULL;

-- Bookings per user (RIGHT JOIN): Counts bookings for every registered user, keeping users who have never booked.
SELECT u.user_id, u.name, COUNT(b.booking_id) AS total_bookings
FROM booking b
RIGHT JOIN users u ON b.user_id = u.user_id
GROUP BY u.user_id, u.name
ORDER BY u.user_id;

-- ======================================================================
-- Trigger walkthrough (changes data: re-run schema.sql afterwards to reset)
-- ======================================================================
-- Booking an out-of-service charger (fires trg_booking_check)
INSERT INTO booking (user_id, charger_id, slot_start, slot_end)
VALUES (2, 4, '2026-09-10 10:00:00', '2026-09-10 11:00:00');

-- Valid booking, then start charging (fires trg_session_start)
INSERT INTO booking (booking_id, user_id, charger_id, slot_start, slot_end)
VALUES (6, 2, 2, '2026-09-10 10:00:00', '2026-09-10 11:00:00');

INSERT INTO charging_session (session_id, vehicle_id, charger_id, booking_id, start_time)
VALUES (6, 2, 2, 6, '2026-09-10 10:03:00');

SELECT charger_id, status FROM charger WHERE charger_id = 2;

-- End the session (fires trg_session_cost and trg_session_end)
UPDATE charging_session
SET end_time = '2026-09-10 10:51:00', energy_kwh = 22.00
WHERE session_id = 6;

SELECT s.session_id, s.energy_kwh, s.cost, c.status AS charger_status,
       b.status AS booking_status, p.amount, p.status AS payment_status
FROM charging_session s
JOIN charger c ON s.charger_id = c.charger_id
JOIN booking b ON s.booking_id = b.booking_id
JOIN payment p ON p.session_id = s.session_id
WHERE s.session_id = 6;
