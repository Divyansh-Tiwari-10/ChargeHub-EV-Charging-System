// Creates ev_charging_db from database/schema.sql (tables, triggers, views, sample data).
// Usage: npm run setup-db
// Warning: drops and recreates the database, so any data added through the app is reset.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config();

// Split a .sql file into statements, honouring DELIMITER changes used by triggers.
function splitStatements(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = [];
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    const d = trimmed.match(/^DELIMITER\s+(\S+)$/i);
    if (d) { delimiter = d[1]; continue; }
    if (buffer.length === 0 && (trimmed === "" || trimmed.startsWith("--"))) continue;
    buffer.push(line);
    if (trimmed.endsWith(delimiter)) {
      const text = buffer.join("\n").trim();
      statements.push(text.slice(0, text.length - delimiter.length).trim());
      buffer = [];
    }
  }
  if (buffer.join("").trim()) statements.push(buffer.join("\n").trim());
  return statements.filter(Boolean);
}

async function main() {
  const file = path.join(__dirname, "..", "database", "schema.sql");
  const statements = splitStatements(fs.readFileSync(file, "utf8"));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });

  console.log(`Running ${statements.length} statements from database/schema.sql ...`);
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (err) {
      console.error("\nFailed on statement:\n" + stmt.split("\n").slice(0, 4).join("\n") + "\n...");
      throw err;
    }
  }
  const [[counts]] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM charger) AS chargers,
            (SELECT COUNT(*) FROM charging_session) AS sessions`);
  await conn.end();
  console.log(`Done. ev_charging_db is ready with ${counts.users} users, ${counts.chargers} chargers and ${counts.sessions} sessions.`);
  console.log("Now run:  npm start");
}

main().catch((err) => {
  console.error("\nDatabase setup failed:", err.message);
  if (err.code === "ER_ACCESS_DENIED_ERROR") console.error("Check DB_USER and DB_PASSWORD in your .env file.");
  if (err.code === "ECONNREFUSED") console.error("MySQL is not running, or DB_HOST / DB_PORT in .env are wrong.");
  process.exit(1);
});
