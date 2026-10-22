-- ChargeHub: EV Charging System (DBMS mini project, MySQL 8.0)
-- Divyansh Tiwari (2025800129), Shreyas Trimbakkar (2025800130), Krishana Tupe (2025800131)
-- Creates the database, tables, triggers, views and sample data.
-- Run with:  npm run setup-db   or   mysql -u root -p < database/schema.sql

-- ======================================================================
-- 1. Database and tables
-- ======================================================================
DROP DATABASE IF EXISTS ev_charging_db;
CREATE DATABASE ev_charging_db;
USE ev_charging_db;

CREATE TABLE users (
    user_id           INT AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(60)  NOT NULL,
    email             VARCHAR(100) NOT NULL UNIQUE,
    phone             CHAR(10)     NOT NULL UNIQUE,
    city              VARCHAR(40),
    registration_date DATE         NOT NULL DEFAULT (CURRENT_DATE)
);

CREATE TABLE vehicle (
    vehicle_id  INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    reg_no      VARCHAR(15)  NOT NULL UNIQUE,
    model       VARCHAR(50)  NOT NULL,
    battery_kwh DECIMAL(5,2) CHECK (battery_kwh > 0),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
);

CREATE TABLE charging_station (
    station_id   INT AUTO_INCREMENT PRIMARY KEY,
    station_name VARCHAR(60)  NOT NULL UNIQUE,
    address      VARCHAR(120) NOT NULL,
    city         VARCHAR(40)  NOT NULL,
    operator     VARCHAR(60)
);

CREATE TABLE tariff (
    tariff_id    INT AUTO_INCREMENT PRIMARY KEY,
    tariff_name  VARCHAR(40)  NOT NULL UNIQUE,
    charger_type VARCHAR(2)   NOT NULL CHECK (charger_type IN ('AC', 'DC')),
    rate_per_kwh DECIMAL(6,2) NOT NULL CHECK (rate_per_kwh > 0)
);

CREATE TABLE charger (
    charger_id     INT AUTO_INCREMENT PRIMARY KEY,
    station_id     INT          NOT NULL,
    tariff_id      INT          NOT NULL,
    charger_type   VARCHAR(2)   NOT NULL CHECK (charger_type IN ('AC', 'DC')),
    power_kw       DECIMAL(6,2) NOT NULL CHECK (power_kw > 0),
    connector_type VARCHAR(15)  NOT NULL,
    status         VARCHAR(20)  NOT NULL DEFAULT 'Available'
                   CHECK (status IN ('Available', 'Busy', 'Out of Service')),
    FOREIGN KEY (station_id) REFERENCES charging_station(station_id) ON DELETE CASCADE,
    FOREIGN KEY (tariff_id)  REFERENCES tariff(tariff_id) ON DELETE RESTRICT
);

CREATE TABLE booking (
    booking_id   INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT         NOT NULL,
    charger_id   INT         NOT NULL,
    booking_date DATE        NOT NULL DEFAULT (CURRENT_DATE),
    slot_start   DATETIME    NOT NULL,
    slot_end     DATETIME    NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'Booked'
                 CHECK (status IN ('Booked', 'Completed', 'Cancelled')),
    CHECK (slot_end > slot_start),
    FOREIGN KEY (user_id)    REFERENCES users(user_id)      ON DELETE RESTRICT,
    FOREIGN KEY (charger_id) REFERENCES charger(charger_id) ON DELETE RESTRICT
);

CREATE TABLE charging_session (
    session_id  INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id  INT          NOT NULL,
    charger_id  INT          NOT NULL,
    booking_id  INT          UNIQUE,
    start_time  DATETIME     NOT NULL,
    end_time    DATETIME,
    energy_kwh  DECIMAL(6,2) CHECK (energy_kwh >= 0),
    cost        DECIMAL(8,2) CHECK (cost >= 0),
    CHECK (end_time IS NULL OR end_time > start_time),
    FOREIGN KEY (vehicle_id) REFERENCES vehicle(vehicle_id) ON DELETE RESTRICT,
    FOREIGN KEY (charger_id) REFERENCES charger(charger_id) ON DELETE RESTRICT,
    FOREIGN KEY (booking_id) REFERENCES booking(booking_id) ON DELETE SET NULL
);

CREATE TABLE payment (
    payment_id   INT AUTO_INCREMENT PRIMARY KEY,
    session_id   INT          NOT NULL UNIQUE,
    amount       DECIMAL(8,2) NOT NULL CHECK (amount > 0),
    mode         VARCHAR(20)  CHECK (mode IN ('UPI', 'Card', 'NetBanking', 'Wallet', 'Cash')),
    payment_date DATE         NOT NULL DEFAULT (CURRENT_DATE),
    status       VARCHAR(10)  NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending', 'Success', 'Failed')),
    FOREIGN KEY (session_id) REFERENCES charging_session(session_id) ON DELETE CASCADE
);

-- ======================================================================
-- 2. Triggers
-- ======================================================================
DELIMITER $$

-- trg_booking_check: Rejects a booking if the charger is out of service or the slot overlaps an existing booking.
CREATE TRIGGER trg_booking_check
BEFORE INSERT ON booking
FOR EACH ROW
BEGIN
    DECLARE ch_status VARCHAR(20);
    SELECT status INTO ch_status FROM charger WHERE charger_id = NEW.charger_id;
    IF ch_status = 'Out of Service' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Charger is out of service and cannot be booked';
    END IF;
    IF EXISTS (SELECT 1 FROM booking
               WHERE charger_id = NEW.charger_id AND status = 'Booked'
                 AND NEW.slot_start < slot_end AND NEW.slot_end > slot_start) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Slot overlaps an existing booking on this charger';
    END IF;
END$$

-- trg_session_start: Marks the charger as Busy as soon as a new (ongoing) session starts on it.
CREATE TRIGGER trg_session_start
AFTER INSERT ON charging_session
FOR EACH ROW
BEGIN
    IF NEW.end_time IS NULL THEN
        UPDATE charger SET status = 'Busy' WHERE charger_id = NEW.charger_id;
    END IF;
END$$

-- trg_session_cost: When a session ends, calculates its cost as energy_kwh × the charger’s tariff rate.
CREATE TRIGGER trg_session_cost
BEFORE UPDATE ON charging_session
FOR EACH ROW
BEGIN
    DECLARE rate DECIMAL(6,2);
    IF OLD.end_time IS NULL AND NEW.end_time IS NOT NULL THEN
        SELECT t.rate_per_kwh INTO rate
        FROM charger c JOIN tariff t ON c.tariff_id = t.tariff_id
        WHERE c.charger_id = NEW.charger_id;
        SET NEW.cost = ROUND(NEW.energy_kwh * rate, 2);
    END IF;
END$$

-- trg_session_end: When a session ends, frees the charger, creates a Pending payment and completes the booking.
CREATE TRIGGER trg_session_end
AFTER UPDATE ON charging_session
FOR EACH ROW
BEGIN
    IF OLD.end_time IS NULL AND NEW.end_time IS NOT NULL THEN
        UPDATE charger SET status = 'Available' WHERE charger_id = NEW.charger_id;
        INSERT INTO payment (session_id, amount, payment_date, status)
        VALUES (NEW.session_id, NEW.cost, DATE(NEW.end_time), 'Pending');
        UPDATE booking SET status = 'Completed' WHERE booking_id = NEW.booking_id;
    END IF;
END$$

DELIMITER ;

-- ======================================================================
-- 3. Views
-- ======================================================================
-- v_charger_availability: Shows every charger with its station, power, connector, tariff rate and current status, so a user can see where to charge without writing joins.
CREATE VIEW v_charger_availability AS
SELECT cs.station_name, cs.city, c.charger_id, c.charger_type,
       c.power_kw, c.connector_type, t.rate_per_kwh, c.status
FROM charger c
JOIN charging_station cs ON c.station_id = cs.station_id
JOIN tariff t            ON c.tariff_id  = t.tariff_id;

-- v_user_charging_history: Combines users, vehicles, sessions, stations and payments into one charging history per user.
CREATE VIEW v_user_charging_history AS
SELECT u.user_id, u.name, s.session_id, v.reg_no, v.model, cs.station_name,
       s.start_time, s.end_time, s.energy_kwh, s.cost, p.status AS payment_status
FROM users u
JOIN vehicle v           ON v.user_id    = u.user_id
JOIN charging_session s  ON s.vehicle_id = v.vehicle_id
JOIN charger c           ON s.charger_id = c.charger_id
JOIN charging_station cs ON c.station_id = cs.station_id
LEFT JOIN payment p      ON p.session_id = s.session_id;

-- v_station_revenue: Summarises each station’s number of sessions, energy delivered and revenue from successful payments.
CREATE VIEW v_station_revenue AS
SELECT cs.station_name, cs.city,
       COUNT(s.session_id)          AS total_sessions,
       IFNULL(SUM(s.energy_kwh), 0) AS total_energy_kwh,
       IFNULL(SUM(p.amount), 0)     AS revenue
FROM charging_station cs
LEFT JOIN charger c          ON c.station_id = cs.station_id
LEFT JOIN charging_session s ON s.charger_id = c.charger_id
LEFT JOIN payment p          ON p.session_id = s.session_id
                            AND p.status = 'Success'
GROUP BY cs.station_id, cs.station_name, cs.city;

-- ======================================================================
-- 4. Sample data
-- ======================================================================
INSERT INTO users (user_id, name, email, phone, city, registration_date) VALUES
    (1, 'Arjun Mehta', 'arjun.mehta@example.com', '9820011223', 'Mumbai', '2026-08-02'),
    (2, 'Sneha Kulkarni', 'sneha.kulkarni@example.com', '9820011224', 'Pune', '2026-08-04'),
    (3, 'Rahul Deshmukh', 'rahul.deshmukh@example.com', '9820011225', 'Mumbai', '2026-08-07'),
    (4, 'Priya Nair', 'priya.nair@example.com', '9820011226', 'Thane', '2026-08-10');

INSERT INTO charging_station (station_id, station_name, address, city, operator) VALUES
    (1, 'ChargeHub Andheri', 'Link Road, Andheri West', 'Mumbai', 'GreenVolt Energy'),
    (2, 'ChargeHub BKC', 'G Block, Bandra Kurla Complex', 'Mumbai', 'GreenVolt Energy'),
    (3, 'ChargeHub Baner', 'Baner Road, Baner', 'Pune', 'UrjaPlus Pvt Ltd');

INSERT INTO tariff (tariff_id, tariff_name, charger_type, rate_per_kwh) VALUES
    (1, 'AC Standard', 'AC', 12.00),
    (2, 'DC Fast', 'DC', 18.00),
    (3, 'DC Ultra Fast', 'DC', 22.00);

INSERT INTO charger (charger_id, station_id, tariff_id, charger_type, power_kw, connector_type, status) VALUES
    (1, 1, 1, 'AC', 7.40, 'Type 2', 'Available'),
    (2, 1, 2, 'DC', 30.00, 'CCS2', 'Available'),
    (3, 2, 3, 'DC', 60.00, 'CCS2', 'Available'),
    (4, 2, 1, 'AC', 22.00, 'Type 2', 'Out of Service'),
    (5, 3, 2, 'DC', 30.00, 'CCS2', 'Available');

INSERT INTO vehicle (vehicle_id, user_id, reg_no, model, battery_kwh) VALUES
    (1, 1, 'MH01AB1234', 'Tata Nexon EV', 40.50),
    (2, 2, 'MH12CD5678', 'MG ZS EV', 50.30),
    (3, 3, 'MH02EF9012', 'Mahindra XUV400', 39.40),
    (4, 4, 'MH04GH3456', 'Hyundai Kona Electric', 39.20),
    (5, 1, 'MH01JK7788', 'Tata Tiago EV', 24.00);

INSERT INTO booking (booking_id, user_id, charger_id, booking_date, slot_start, slot_end, status) VALUES
    (1, 1, 2, '2026-09-01', '2026-09-02 09:00:00', '2026-09-02 10:00:00', 'Completed'),
    (2, 2, 5, '2026-09-02', '2026-09-03 18:00:00', '2026-09-03 19:00:00', 'Completed'),
    (3, 3, 3, '2026-09-03', '2026-09-04 11:00:00', '2026-09-04 11:30:00', 'Completed'),
    (4, 4, 1, '2026-09-04', '2026-09-05 08:00:00', '2026-09-05 11:00:00', 'Cancelled'),
    (5, 1, 3, '2026-09-06', '2026-09-07 17:00:00', '2026-09-07 17:45:00', 'Completed');

INSERT INTO charging_session (session_id, vehicle_id, charger_id, booking_id, start_time, end_time, energy_kwh, cost) VALUES
    (1, 1, 2, 1, '2026-09-02 09:05:00', '2026-09-02 09:55:00', 24.00, 432.00),
    (2, 2, 5, 2, '2026-09-03 18:02:00', '2026-09-03 18:58:00', 26.50, 477.00),
    (3, 3, 3, 3, '2026-09-04 11:00:00', '2026-09-04 11:28:00', 25.00, 550.00),
    (4, 4, 1, NULL, '2026-09-05 14:00:00', '2026-09-05 17:00:00', 20.00, 240.00),
    (5, 5, 3, 5, '2026-09-07 17:05:00', '2026-09-07 17:40:00', 18.00, 396.00);

INSERT INTO payment (payment_id, session_id, amount, mode, payment_date, status) VALUES
    (1, 1, 432.00, 'UPI', '2026-09-02', 'Success'),
    (2, 2, 477.00, 'Card', '2026-09-03', 'Success'),
    (3, 3, 550.00, 'UPI', '2026-09-04', 'Success'),
    (4, 4, 240.00, 'Wallet', '2026-09-05', 'Success'),
    (5, 5, 396.00, 'NetBanking', '2026-09-07', 'Pending');
