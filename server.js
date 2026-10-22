// ChargeHub: EV charging management system
// Express backend that serves the web frontend (public/) and a JSON API backed by MySQL.
require("dotenv").config();
const path = require("path");
const express = require("express");
const { pool } = require("./config/db");
const { errorHandler } = require("./middleware/errors");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (req, res) => {
  try {
    const [[row]] = await pool.query("SELECT DATABASE() AS db, VERSION() AS version, NOW() AS server_time");
    res.json({ ok: true, ...row });
  } catch (err) {
    // Keep raw database errors (which can include usernames and connection details) out of the public response.
    res.status(503).json({ ok: false, code: err.code || "DATABASE_ERROR" });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/public"));
app.use("/api/me", require("./routes/driver"));
app.use("/api/admin", require("./routes/admin"));

app.use("/api", (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, async () => {
  console.log(`ChargeHub is running at http://localhost:${PORT}`);
  try {
    const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM charging_station");
    console.log(`Connected to MySQL database '${process.env.DB_NAME || "ev_charging_db"}' (${row.n} stations).`);
  } catch (err) {
    console.error(`Could not query the database: ${err.message}`);
    console.error("Check your .env settings and run  npm run setup-db  first.");
  }
});
