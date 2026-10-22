// Turns MySQL errors (including messages raised by triggers) into clear API responses.
const MYSQL_ERRORS = {
  1644: { status: 400 },                                                       // SIGNAL from a trigger
  1062: { status: 409, message: "That value already exists. Emails, phone numbers, registration numbers and names must be unique." },
  1451: { status: 409, message: "This record is used by other records, so it can't be deleted." },
  1452: { status: 400, message: "A linked record doesn't exist. Check the selected user, vehicle, station, charger or tariff." },
  3819: { status: 400, message: "A value breaks a CHECK constraint. Check numbers are positive and times are in order." },
  1048: { status: 400, message: "A required field is missing." },
};

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function errorHandler(err, req, res, next) {
  const known = MYSQL_ERRORS[err.errno];
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  if (known) {
    return res.status(known.status).json({
      error: known.message || err.sqlMessage || err.message,
      mysql: { code: err.code, errno: err.errno, sqlMessage: err.sqlMessage },
    });
  }
  if (err.code === "ECONNREFUSED" || err.code === "ER_ACCESS_DENIED_ERROR" || err.code === "ER_BAD_DB_ERROR") {
    return res.status(503).json({ error: "Can't reach the database. Check MySQL is running and your .env settings, then run npm run setup-db." });
  }
  console.error(err);
  res.status(500).json({ error: err.sqlMessage || err.message || "Something went wrong on the server." });
}

// Wrap async route handlers so thrown errors reach errorHandler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, errorHandler, ah };
