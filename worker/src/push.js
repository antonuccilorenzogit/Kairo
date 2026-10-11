// Web Push without external libraries: VAPID (RFC 8292) and message encryption aes128gcm (RFC 8291),
// all with the Web Crypto API available in Workers. Works on iPhone (iOS 16.4+, app added to the
// Home Screen), Android and desktop browsers.

const enc = new TextEncoder();
export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// VAPID key pair, created once and kept in the settings table.
export async function getVapid(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first();
  if (row) return JSON.parse(row.value);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapid = { publicKey: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
  await db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('vapid',?)").bind(JSON.stringify(vapid)).run();
  return JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first()).value);
}

export async function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// RFC 8291: returns the request body (header + ciphertext) for one record.
export async function encryptPayload(text, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys } = {}) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const as = serverKeys || (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Sends a notification to every subscribed device; removes subscriptions that no longer exist.
export async function sendPush(env, message, origin) {
  const subs = (await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs").all()).results;
  if (!subs.length) return { inviate: 0 };
  const vapid = await getVapid(env.DB);
  let sent = 0;
  for (const s of subs) {
    try {
      const body = await encryptPayload(JSON.stringify(message), s.p256dh, s.auth);
      const res = await fetch(s.endpoint, { method: "POST", body, headers: {
        authorization: await vapidHeader(s.endpoint, vapid, origin || "mailto:kairo@users.noreply.github.com"),
        "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "21600", urgency: "normal" } });
      if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run();
      else if (res.ok) sent++;
    } catch (_) { /* a broken subscription must not stop the others */ }
  }
  return { inviate: sent, dispositivi: subs.length };
}

// Allowed push services (prevents using the server to send requests to arbitrary addresses).
export function validEndpoint(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)(push\.apple\.com|googleapis\.com|mozilla\.com|mozaws\.net|notify\.windows\.com|push\.services\.mozilla\.com)$/.test(url.hostname);
  } catch { return false; }
}
