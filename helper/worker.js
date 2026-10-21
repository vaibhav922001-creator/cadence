/**
 * Cadence sync helper — a Cloudflare Worker that keeps a long-lived, read-only Google sign-in for Cadence,
 * so the app can get a fresh 1-hour access token on every open without a sign-in pop-up.
 *
 * Endpoints
 *   GET  /                 health check → "ok"
 *   GET  /auth/start       → redirects to Google consent (offline access). Sets a short-lived nonce cookie.
 *   GET  /auth/callback    ← Google redirect. Exchanges the code, stores the refresh token encrypted,
 *                            then redirects back to the Cadence site with #cadence-helper=<device id>.
 *   POST /token  {sid}     → { access_token, expires_in, scope }      (CORS: the Cadence site only)
 *   POST /logout {sid}     → revokes the Google grant and deletes the stored token
 *
 * Storage (KV namespace bound as TOKENS)
 *   key   "rt:" + hex(SHA-256(sid))
 *   value { v, iv, ct, scope, created }  — the refresh token encrypted with AES-GCM under a key derived
 *         from the device id (HKDF). The device id itself is never stored, so the KV data alone can't be used.
 *   expires 8 days after sign-in (Google ends refresh tokens of apps in "Testing" mode after 7 days).
 *
 * Settings
 *   vars:    GOOGLE_CLIENT_ID, SITE_URL (e.g. https://user.github.io/cadence/), ALLOWED_ORIGIN (e.g. https://user.github.io)
 *   secret:  GOOGLE_CLIENT_SECRET   (also the root for the state-signing key)
 */

const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "openid",
  "email",
];
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const KV_TTL_SEC = 8 * 24 * 3600;
const NONCE_COOKIE = "cadence_nonce";
const SID_RE = /^[A-Za-z0-9_-]{43}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- small helpers ---------- */
function b64url(bytes) {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hkdfKey(ikmBytes, salt, info, usage) {
  const base = await crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveKey"]);
  const alg = usage === "hmac" ? { name: "HMAC", hash: "SHA-256", length: 256 } : { name: "AES-GCM", length: 256 };
  const uses = usage === "hmac" ? ["sign", "verify"] : ["encrypt", "decrypt"];
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(salt), info: enc.encode(info) }, base, alg, false, uses);
}
const stateKey = (env) => hkdfKey(enc.encode(env.GOOGLE_CLIENT_SECRET), "cadence-helper-v1", "state-signing", "hmac");
const sidKey = (sid) => hkdfKey(unb64url(sid), "cadence-helper-v1", "refresh-token", "aes");
async function kvKey(sid) {
  return "rt:" + hex(await crypto.subtle.digest("SHA-256", enc.encode(sid)));
}

function siteUrl(env) {
  const u = new URL(env.SITE_URL);
  u.hash = "";
  u.search = "";
  return u.toString();
}
function backToSite(env, frag) {
  return new Response(null, { status: 302, headers: { Location: siteUrl(env) + "#" + frag, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function cookieOf(req, name) {
  const c = req.headers.get("Cookie") || "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
function corsHeaders(env, req) {
  const origin = req.headers.get("Origin");
  const h = { Vary: "Origin", "Cache-Control": "no-store" };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
function json(env, req, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(env, req), "Content-Type": "application/json" } });
}
function configError(env) {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SITE_URL", "ALLOWED_ORIGIN"].filter((k) => !env[k]);
  if (!env.TOKENS) missing.push("TOKENS (KV binding)");
  return missing.length ? missing : null;
}
async function googleToken(params) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}
async function readStored(env, sid) {
  const key = await kvKey(sid);
  const raw = await env.TOKENS.get(key);
  if (!raw) return { key, rec: null, rt: null };
  try {
    const rec = JSON.parse(raw);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(rec.iv) }, await sidKey(sid), unb64url(rec.ct));
    return { key, rec, rt: dec.decode(pt) };
  } catch (e) {
    return { key, rec: null, rt: null }; // unreadable → treat as signed out
  }
}
async function writeStored(env, sid, refreshToken, scope, created) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sidKey(sid), enc.encode(refreshToken));
  const rec = { v: 1, iv: b64url(iv), ct: b64url(ct), scope: scope || "", created: created || Date.now() };
  const ageSec = Math.floor((Date.now() - rec.created) / 1000);
  await env.TOKENS.put(await kvKey(sid), JSON.stringify(rec), { expirationTtl: Math.max(60, KV_TTL_SEC - ageSec) });
}
async function readSid(req) {
  let body = null;
  try {
    body = await req.json();
  } catch (e) {
    return null;
  }
  const sid = body && typeof body.sid === "string" ? body.sid : "";
  return SID_RE.test(sid) ? sid : null;
}

/* ---------- routes ---------- */
async function authStart(req, env, url) {
  const nonce = b64url(randomBytes(16));
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, n: nonce, t: Date.now() })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await stateKey(env), enc.encode(payload)));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + "/auth/callback",
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: payload + "." + sig,
  });
  const hint = url.searchParams.get("hint");
  if (hint && hint.length < 200 && /^[^\s@]+@[^\s@]+$/.test(hint)) q.set("login_hint", hint);
  return new Response(null, {
    status: 302,
    headers: {
      Location: GOOGLE_AUTH + "?" + q.toString(),
      "Set-Cookie": `${NONCE_COOKIE}=${nonce}; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function authCallback(req, env, url) {
  const err = url.searchParams.get("error");
  if (err) return backToSite(env, "cadence-helper-error=" + encodeURIComponent(err.slice(0, 60)));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const [payload, sig] = state.split(".");
  if (!code || !payload || !sig) return backToSite(env, "cadence-helper-error=bad_request");
  let okSig = false;
  try {
    okSig = await crypto.subtle.verify("HMAC", await stateKey(env), unb64url(sig), enc.encode(payload));
  } catch (e) {}
  if (!okSig) return backToSite(env, "cadence-helper-error=bad_state");
  let st = null;
  try {
    st = JSON.parse(dec.decode(unb64url(payload)));
  } catch (e) {}
  if (!st || typeof st.t !== "number" || Date.now() - st.t > STATE_MAX_AGE_MS || Date.now() < st.t - 60000) return backToSite(env, "cadence-helper-error=expired");
  const cookieNonce = cookieOf(req, NONCE_COOKIE);
  if (!cookieNonce || typeof st.n !== "string" || !timingSafeEqual(cookieNonce, st.n)) return backToSite(env, "cadence-helper-error=bad_state");

  const r = await googleToken({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: url.origin + "/auth/callback",
    grant_type: "authorization_code",
  });
  if (!r.ok || !r.data.access_token) return backToSite(env, "cadence-helper-error=" + encodeURIComponent(String(r.data.error || "exchange_failed").slice(0, 60)));
  if (!r.data.refresh_token) return backToSite(env, "cadence-helper-error=no_refresh_token");

  const sid = b64url(randomBytes(32));
  await writeStored(env, sid, r.data.refresh_token, r.data.scope, Date.now());
  const res = backToSite(env, "cadence-helper=" + sid);
  res.headers.append("Set-Cookie", `${NONCE_COOKIE}=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return res;
}

async function token(req, env) {
  const sid = await readSid(req);
  if (!sid) return json(env, req, 400, { error: "bad_request" });
  const { key, rec, rt } = await readStored(env, sid);
  if (!rt) return json(env, req, 401, { error: "reauth" });
  let r;
  try {
    r = await googleToken({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" });
  } catch (e) {
    return json(env, req, 502, { error: "upstream" });
  }
  if (!r.ok || !r.data.access_token) {
    if (r.data && (r.data.error === "invalid_grant" || r.data.error === "unauthorized_client")) {
      await env.TOKENS.delete(key); // expired or revoked: the user must sign in again
      return json(env, req, 401, { error: "reauth" });
    }
    return json(env, req, 502, { error: "upstream", detail: String((r.data && r.data.error) || r.status).slice(0, 60) });
  }
  if (r.data.refresh_token && r.data.refresh_token !== rt) await writeStored(env, sid, r.data.refresh_token, r.data.scope || rec.scope, rec.created);
  return json(env, req, 200, {
    access_token: r.data.access_token,
    expires_in: Number(r.data.expires_in) || 3599,
    scope: r.data.scope || rec.scope || "",
    signed_in_at: rec.created,
    expires_at: rec.created + 7 * 24 * 3600 * 1000,
  });
}

async function logout(req, env) {
  const sid = await readSid(req);
  if (!sid) return json(env, req, 400, { error: "bad_request" });
  const { key, rt } = await readStored(env, sid);
  if (rt) {
    try {
      await fetch(GOOGLE_REVOKE, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" + encodeURIComponent(rt) });
    } catch (e) {}
  }
  await env.TOKENS.delete(key);
  return json(env, req, 200, { ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const missing = configError(env);
    if (missing) return new Response("Cadence helper is not configured: " + missing.join(", "), { status: 500 });
    if (req.method === "OPTIONS") {
      const h = corsHeaders(env, req);
      return new Response(null, { status: h["Access-Control-Allow-Origin"] ? 204 : 403, headers: h });
    }
    try {
      if (req.method === "GET" && url.pathname === "/") return new Response("ok", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
      if (req.method === "GET" && url.pathname === "/auth/start") return await authStart(req, env, url);
      if (req.method === "GET" && url.pathname === "/auth/callback") return await authCallback(req, env, url);
      if (req.method === "POST" && (url.pathname === "/token" || url.pathname === "/logout")) {
        const origin = req.headers.get("Origin");
        if (origin !== env.ALLOWED_ORIGIN) return json(env, req, 403, { error: "forbidden_origin" });
        return url.pathname === "/token" ? await token(req, env) : await logout(req, env);
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json(env, req, 500, { error: "internal" });
    }
  },
};
