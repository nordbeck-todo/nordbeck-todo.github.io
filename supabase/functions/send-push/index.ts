// @ts-nocheck
// Web Push ohne Fremdbibliothek: VAPID (RFC 8292) + Verschlüsselung aes128gcm (RFC 8291)
// Läuft mit WebCrypto in Deno (Supabase Edge Functions) und Node 20+.

const enc = new TextEncoder();

function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(b) {
  let bin = "";
  const a = new Uint8Array(b);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// ---------- VAPID ----------
async function vapidKey(publicB64u, privateB64u) {
  const pub = b64uToBytes(publicB64u);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: privateB64u, ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function vapidHeader(endpoint, publicB64u, privateB64u, subject) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })));
  const key = await vapidKey(publicB64u, privateB64u);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${bytesToB64u(sig)}, k=${publicB64u}`;
}

// ---------- Verschlüsselung ----------
async function encryptPayload(p256dhB64u, authB64u, plaintext, opts = {}) {
  const uaPublic = b64uToBytes(p256dhB64u);
  const authSecret = b64uToBytes(authB64u);

  const asKeys = opts.asKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));

  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const data = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2]));   // Trenner für den letzten Datensatz
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ---------- Senden ----------
async function sendPush(sub, payload, vapid, ttl = 86400) {
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(payload));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(ttl),
      "Urgency": "high",
    },
    body,
  });
  return res.status;
}

// =====================================================================
// Edge Function „send-push“ – verschickt eine Benachrichtigung als Push
// Aufruf durch die Datenbank (Trigger) mit { "id": <notification-id> }.
// Geheim (in Supabase eintragen): VAPID_PRIVATE_KEY
// =====================================================================
const VAPID = {
  publicKey: "BHlRubIBz3jSkihl77pdxFZMYKzHn2io37VDF4YtQ-9Q9Q4FIuIJFOgJmZK-LpCuUmqRC2Fu6rD1NTWeoUr9eBQ",
  privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
  subject: "https://www.tischlermeister-nordbeck.de",
};
const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  try {
    const { id } = await req.json();
    if (!id || !VAPID.privateKey) return new Response("skip", { status: 200 });
    // Benachrichtigung „beanspruchen“ – nur einmal senden
    const rows = await rest(`notifications?id=eq.${Number(id)}&pushed_at=is.null`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ pushed_at: new Date().toISOString() }),
    });
    const n = Array.isArray(rows) ? rows[0] : null;
    if (!n) return new Response("already", { status: 200 });
    const subs = await rest(`push_subscriptions?user_id=eq.${n.user_id}&select=id,endpoint,p256dh,auth`) || [];
    const payload = {
      title: n.title, body: n.body || "", tag: `n${n.id}`,
      url: n.task_id ? `./#/aufgabe/${n.task_id}` : "./#/",
    };
    let sent = 0;
    for (const s of subs) {
      try {
        const status = await sendPush(s, payload, VAPID);
        if (status === 404 || status === 410) {
          await rest(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" });
        } else if (status < 300) sent++;
      } catch (_) { /* einzelnes Gerät fehlgeschlagen */ }
    }
    return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
