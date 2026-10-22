// Login and sign-up. Drivers log in with their email; the admin uses ADMIN_PASSWORD from .env.
const router = require("express").Router();
const { query } = require("../config/db");
const { AppError, ah } = require("../middleware/errors");

router.post("/login", ah(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) throw new AppError(400, "Enter your email.");
  const rows = await query("SELECT * FROM users WHERE LOWER(email) = ?", [email]);
  if (!rows.length) throw new AppError(404, "No account uses that email. Create one first.");
  res.json(rows[0]);
}));

router.post("/register", ah(async (req, res) => {
  const { name, email, phone, city } = req.body;
  if (!name || !email || !phone) throw new AppError(400, "Name, email and phone are required.");
  if (!/^\d{10}$/.test(String(phone))) throw new AppError(400, "Phone must be 10 digits.");
  const result = await query(
    "INSERT INTO users (name, email, phone, city) VALUES (?, ?, ?, ?)",
    [name.trim(), email.trim().toLowerCase(), String(phone), city ? city.trim() : null]);
  const [user] = await query("SELECT * FROM users WHERE user_id = ?", [result.insertId]);
  res.status(201).json(user);
}));

router.post("/admin", (req, res) => {
  if (req.body.password && req.body.password === (process.env.ADMIN_PASSWORD || "admin123")) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Wrong admin password." });
});

module.exports = router;
