// Very small role check for the demo: admin routes need the admin password in a header.
// (A production app would use real sessions or JWT tokens and hashed passwords.)
require("dotenv").config();

function requireAdmin(req, res, next) {
  const key = req.get("x-admin-key");
  if (key && key === (process.env.ADMIN_PASSWORD || "admin123")) return next();
  res.status(401).json({ error: "Admin login required." });
}

module.exports = { requireAdmin };
