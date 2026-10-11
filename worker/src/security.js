// Access control: constant-time comparisons and a temporary lock-out after repeated failures.

export const MIN_CODE_LENGTH = 10;   // new or changed access codes
const MAX_FAILS = 5;                 // wrong attempts allowed in the window…
const WINDOW_S = 15 * 60;            // …of 15 minutes
const LOCK_S = 15 * 60;              // first lock: 15 minutes, then doubles each time
const MAX_LOCK_S = 24 * 3600;        // up to 24 hours

const now = () => Math.floor(Date.now() / 1000);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares two strings in constant time (no early exit that would leak how many characters match).
export function safeEqual(a, b) {
  a = String(a ?? ""); b = String(b ?? "");
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const clientIp = (req) => req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "sconosciuto";

// Seconds left on the lock for this client (0 = not locked).
export async function lockedFor(db, ip) {
  const r = await db.prepare("SELECT locked_until FROM auth_fail WHERE ip = ?").bind(ip).first();
  return r ? Math.max(0, r.locked_until - now()) : 0;
}

// Records a failed attempt; returns the lock duration in seconds if this attempt triggered a lock.
export async function recordFailure(db, ip) {
  const t = now();
  const r = await db.prepare("SELECT n, first, locks FROM auth_fail WHERE ip = ?").bind(ip).first();
  let n = 1, first = t, locks = r?.locks || 0, lockedUntil = 0;
  if (r && t - r.first < WINDOW_S) { n = r.n + 1; first = r.first; }
  if (n >= MAX_FAILS) {
    const dur = Math.min(MAX_LOCK_S, LOCK_S * 2 ** locks);
    lockedUntil = t + dur; locks += 1; n = 0; first = t;
    await db.prepare("INSERT INTO auth_fail(ip,n,first,locked_until,locks) VALUES(?,?,?,?,?) ON CONFLICT(ip) DO UPDATE SET n=excluded.n, first=excluded.first, locked_until=excluded.locked_until, locks=excluded.locks")
      .bind(ip, n, first, lockedUntil, locks).run();
    return dur;
  }
  await db.prepare("INSERT INTO auth_fail(ip,n,first,locked_until,locks) VALUES(?,?,?,0,?) ON CONFLICT(ip) DO UPDATE SET n=excluded.n, first=excluded.first, locks=excluded.locks")
    .bind(ip, n, first, locks).run();
  return 0;
}

export async function clearFailures(db, ip) {
  await db.prepare("DELETE FROM auth_fail WHERE ip = ?").bind(ip).run();
}

// Old rows are useless after a day without new failures.
export async function pruneFailures(db) {
  await db.prepare("DELETE FROM auth_fail WHERE locked_until < ? AND first < ?").bind(now(), now() - MAX_LOCK_S).run();
}

export function codeProblem(code) {
  const c = String(code || "");
  if (c.length < MIN_CODE_LENGTH) return `Il codice deve avere almeno ${MIN_CODE_LENGTH} caratteri.`;
  if (c.length > 200) return "Il codice è troppo lungo (massimo 200 caratteri).";
  if (/^(.)\1+$/.test(c)) return "Il codice non può essere un solo carattere ripetuto.";
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(c)) return "Il codice è troppo facile da indovinare.";
  return null;
}
