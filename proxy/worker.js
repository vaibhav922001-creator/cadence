/*
 * Cadence — tiny Google Health proxy (Cloudflare Worker).
 *
 * Only needed if your browser blocks direct calls to health.googleapis.com (CORS).
 * It forwards requests from YOUR Cadence site to https://health.googleapis.com, passing the
 * Authorization header through. It stores nothing and logs nothing.
 *
 * Set one variable in the Worker settings:
 *   ALLOWED_ORIGIN = https://USERNAME.github.io      (your Cadence site, no trailing slash)
 *
 * Then paste the Worker URL (e.g. https://cadence-proxy.USERNAME.workers.dev) into Cadence as "Proxy URL".
 */
const UPSTREAM = "https://health.googleapis.com";
// Only these paths are forwarded: the user's own data points (list, dailyRollUp, rollUp) and identity.
const PATH_OK = /^\/v4\/users\/me\/(dataTypes\/[a-z0-9-]+\/dataPoints(:dailyRollUp|:rollUp)?|identity)$/;

export default {
  async fetch(request, env) {
    const allowed = String((env && env.ALLOWED_ORIGIN) || "").replace(/\/+$/, "");
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (status, msg) =>
      new Response(JSON.stringify({ error: { code: status, status: "PROXY", message: msg } }), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (!allowed) return reply(500, "Proxy is not configured: set ALLOWED_ORIGIN.");
    if (origin !== allowed) return reply(403, "This proxy only serves the configured Cadence site.");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "POST") return reply(405, "Only GET and POST are allowed.");

    const url = new URL(request.url);
    if (!PATH_OK.test(url.pathname)) return reply(404, "Path not allowed.");
    const auth = request.headers.get("Authorization") || "";
    if (!/^Bearer [\w.\-~+/]+=*$/.test(auth)) return reply(401, "Missing Google access token.");

    const headers = { Authorization: auth, Accept: "application/json" };
    let body;
    if (request.method === "POST") {
      headers["Content-Type"] = "application/json";
      body = await request.text();
      if (body.length > 10000) return reply(413, "Request too large.");
    }
    let up;
    try {
      up = await fetch(UPSTREAM + url.pathname + url.search, { method: request.method, headers, body });
    } catch (e) {
      return reply(502, "Could not reach Google Health.");
    }
    const out = new Headers(cors);
    out.set("Content-Type", up.headers.get("Content-Type") || "application/json");
    const ra = up.headers.get("Retry-After");
    if (ra) {
      out.set("Retry-After", ra);
      out.set("Access-Control-Expose-Headers", "Retry-After");
    }
    out.set("Cache-Control", "no-store");
    return new Response(up.body, { status: up.status, headers: out });
  },
};
