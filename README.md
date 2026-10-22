# ChargeHub: EV Charging System

DBMS mini project by **Divyansh Tiwari (2025800129)**, **Shreyas Trimbakkar (2025800130)** and **Krishana Tupe (2025800131)**.

ChargeHub is a web app for an EV charging network. Drivers find a free charger, book a slot, charge their car and pay for the energy used. The station operator (admin) manages stations, chargers, tariffs and users, and can see revenue and run SQL reports.

Everything is stored in one MySQL database, `ev_charging_db`, with 8 tables, 4 triggers and 3 views.

## Tech stack

| Layer    | Technology |
|----------|------------|
| Frontend | HTML, CSS and plain JavaScript (no framework), served by Express |
| Backend  | Node.js + Express REST API |
| Database | MySQL 8.0, connected through the `mysql2` driver with a connection pool |

## Features

**Driver**
- Log in with email or create an account
- Find a charger by city and type, with live status (Available, Busy, Out of Service)
- **Charge now** on a free charger (walk-in) or **book a slot** in advance
- Live charging screen with a simulated meter (kWh, cost, battery %)
- Stop charging: the database calculates the bill and creates a payment
- Pay pending bills (simulated UPI, card, net banking, wallet or cash)
- Manage vehicles; see bookings and full charging history

**Admin** (password from `.env`, default `admin123`)
- Dashboard: revenue, pending payments, energy delivered, charger status, revenue by station
- Add, edit and delete stations, chargers and tariffs; take chargers offline
- View users, bookings, charging sessions and payments
- **SQL reports**: runs the 3 views and 4 join queries live and shows their SQL
- **Triggers**: lists the triggers straight from `information_schema`
- **SQL console**: run read-only queries (SELECT, SHOW, DESCRIBE) for the viva

## Database objects

| Type | Name | What it does |
|------|------|--------------|
| Trigger | `trg_booking_check` | BEFORE INSERT on booking: rejects out-of-service chargers and overlapping slots |
| Trigger | `trg_session_start` | AFTER INSERT on charging_session: sets the charger to Busy |
| Trigger | `trg_session_cost` | BEFORE UPDATE on charging_session: cost = energy_kwh × tariff rate |
| Trigger | `trg_session_end` | AFTER UPDATE on charging_session: frees the charger, adds a Pending payment, completes the booking |
| View | `v_charger_availability` | Chargers with station, tariff and status |
| View | `v_user_charging_history` | Each user's sessions with vehicle, station, cost and payment status |
| View | `v_station_revenue` | Sessions, energy and revenue per station |
| Join | INNER JOIN | Booking details (Admin → Bookings) |
| Join | LEFT JOIN | Charger utilisation, including unused chargers |
| Join | LEFT JOIN + IS NULL | Walk-in sessions without a booking |
| Join | RIGHT JOIN | Bookings per user, including users who never booked |

## Folder structure

```
ev-charging-system/
├── server.js              Express app: serves public/ and the /api routes
├── config/db.js           MySQL connection pool (mysql2)
├── routes/
│   ├── auth.js            Driver login/sign-up, admin login
│   ├── public.js          Stations, charger availability, tariffs
│   ├── driver.js          Vehicles, bookings, sessions, payments, history
│   ├── admin.js           Dashboard, CRUD, reports, triggers, SQL console
│   └── reports-data.js    SQL text for the views and join reports
├── middleware/            Error handling (MySQL errors to clear messages), admin check
├── database/
│   ├── schema.sql         Tables, constraints, triggers, views and sample data
│   └── queries.sql        Views, joins and a trigger walkthrough to run by hand
├── scripts/setup-db.js    Loads schema.sql into MySQL (npm run setup-db)
└── public/                Frontend: index.html, css/, js/, fonts/
```

## How to run it

### 1. Install the software (once)

- **Node.js 18 or newer** (LTS): https://nodejs.org
- **MySQL 8.0**: on Windows use MySQL Installer (https://dev.mysql.com/downloads/installer/) and remember the root password you set. MySQL Workbench is optional but handy.
  XAMPP's MySQL (MariaDB 10.4+) also works.

Check they're installed by opening a terminal (Command Prompt or PowerShell on Windows):

```
node -v
npm -v
```

### 2. Install the project's packages

Open a terminal **inside the `ev-charging-system` folder** and run:

```
npm install
```

### 3. Add your MySQL password

Copy `.env.example` to a new file named `.env` and set `DB_PASSWORD` to your MySQL root password:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=ev_charging_db
PORT=3000
ADMIN_PASSWORD=admin123
```

### 4. Create the database

```
npm run setup-db
```

This creates `ev_charging_db` with all tables, triggers, views and sample data. You can instead run `database/schema.sql` in MySQL Workbench (File → Open SQL Script → run all).

### 5. Start the app

```
npm start
```

Open **http://localhost:3000** in your browser.

## Logins

| Role | How to log in |
|------|---------------|
| Driver | `arjun.mehta@example.com`, `sneha.kulkarni@example.com`, `rahul.deshmukh@example.com` or `priya.nair@example.com` (no password), or create a new account |
| Admin | Admin tab, password `admin123` (change it in `.env`) |

## Demo walkthrough for the viva

1. **Driver: Sneha.** Find a charger → **Charge now** on charger #2. The toast shows `trg_session_start` set the charger to Busy.
2. On Home, watch the live meter, then **Stop charging**. The toast shows `trg_session_cost` worked out the bill and `trg_session_end` freed the charger and created a payment.
3. Payments → **Pay**.
4. Find a charger → **Book a slot** on charger #3. Book the same time again to see `trg_booking_check` reject the overlapping slot. Try booking charger #4 (out of service) to see the other check.
5. My bookings → **Start charging** on the booking, then stop it. The booking becomes Completed.
6. **Admin.** Dashboard shows the new revenue (from `v_station_revenue`). Chargers → **Take offline** a charger and check that drivers can no longer book it.
7. SQL reports → click each view and join to show the SQL and live result. Triggers shows the trigger code from MySQL. SQL console runs any SELECT.

To reset the sample data at any time, run `npm run setup-db` again.

## API reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Database connection check |
| POST | `/api/auth/login`, `/api/auth/register`, `/api/auth/admin` | Log in or sign up |
| GET | `/api/stations` | Stations with their chargers |
| GET | `/api/chargers/available` | From `v_charger_availability` |
| GET, POST, DELETE | `/api/me/vehicles` | Driver's vehicles |
| GET, POST | `/api/me/bookings`, PATCH `/api/me/bookings/:id/cancel` | Bookings |
| GET | `/api/me/sessions` | Driver's sessions (`?active=1` for ongoing) |
| POST | `/api/me/sessions/start`, `/api/me/sessions/:id/stop` | Start or stop charging |
| GET | `/api/me/payments`, POST `/api/me/payments/:id/pay` | Payments |
| GET | `/api/me/history` | From `v_user_charging_history` |
| GET | `/api/admin/stats` | Dashboard numbers |
| GET, POST, PUT, DELETE | `/api/admin/stations`, `/api/admin/chargers`, `/api/admin/tariffs` | Manage network |
| GET | `/api/admin/users`, `/bookings`, `/sessions`, `/payments` | Activity lists |
| GET | `/api/admin/reports/:key`, `/api/admin/triggers` | Views, joins and triggers |
| POST | `/api/admin/sql` | Read-only SQL console |

Driver routes need the `x-user-id` header and admin routes need `x-admin-key`. The frontend adds these automatically.

## Troubleshooting

| Message | Fix |
|---------|-----|
| `Access denied for user 'root'@'localhost'` | Wrong `DB_PASSWORD` in `.env` |
| `connect ECONNREFUSED 127.0.0.1:3306` | MySQL isn't running. Start the MySQL80 service (Windows: Services app) or start MySQL in XAMPP |
| `Unknown database 'ev_charging_db'` | Run `npm run setup-db` |
| `'npm' is not recognized` | Install Node.js and reopen the terminal |
| `EADDRINUSE: address already in use :::3000` | Another app uses port 3000. Set `PORT=3001` in `.env` |

## Notes and limits

- Charger hardware and payments are simulated. The live meter speeds time up (1 real second = 1 minute of charging) so a demo doesn't take hours.
- Driver login uses email only and the admin check is a shared password. A real deployment would add hashed passwords and proper sessions.

## Screenshots

See `docs/screenshots/`: login, find a charger, live charging, admin dashboard and SQL reports.
