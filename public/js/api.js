// Small fetch wrapper: sends JSON, adds the login headers and turns API errors into exceptions.
import { session } from "./session.js";

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const s = session.get();
  if (s?.role === "driver") headers["x-user-id"] = s.user.user_id;
  if (s?.role === "admin") headers["x-admin-key"] = s.key;

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Can't reach the ChargeHub server. Check that npm start is still running.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && s) { session.clear(); location.hash = ""; location.reload(); }
    throw new ApiError(data.error || `Request failed (${res.status})`, data.mysql);
  }
  return data;
}

export class ApiError extends Error {
  constructor(message, mysql) { super(message); this.mysql = mysql; }
}
