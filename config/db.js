// MySQL connection pool shared by every route.
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ev_charging_db",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,     // return DATE/DATETIME as 'YYYY-MM-DD HH:MM:SS' text
  decimalNumbers: true,  // return DECIMAL columns as numbers
});

// Run a query and return only the rows.
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Run several queries inside one transaction.
async function transaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transaction };
