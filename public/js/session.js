// Remembers who is logged in (driver or admin) in this browser.
const KEY = "chargehub-session";

export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  },
  set(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode: stay logged in for this tab only */ }
    memory = value;
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    memory = null;
  },
};

// Fallback when localStorage is unavailable.
let memory = null;
const original = session.get;
session.get = () => original() || memory;
