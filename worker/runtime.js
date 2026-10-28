const HTML_B64 = "__MIRA_HTML_B64__";
const CSS_B64 = "__MIRA_CSS_B64__";
const JS_B64 = "__MIRA_JS_B64__";
const AVATAR_B64 = "__MIRA_AVATAR_B64__";

const tokenWindows = new Map();
const TOKEN_WINDOW_MS = 10 * 60 * 1000;
const TOKEN_LIMIT = 5;
const GITHUB_PAGES_ORIGIN = "https://dhairya1611.github.io";

function decodeText(base64) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeBytes(base64) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function securityHeaders(contentType, cacheControl = "no-store") {
  return {
    "cache-control": cacheControl,
    "content-type": contentType,
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(self), microphone=(self), geolocation=()",
    "content-security-policy": "default-src 'self'; script-src 'self' https://esm.sh https://cdn.jsdelivr.net https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://lh3.googleusercontent.com; media-src 'self' blob:; connect-src 'self' https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://esm.sh https://cdn.jsdelivr.net https://storage.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com wss://firestore.googleapis.com https://www.googleapis.com; frame-src https://accounts.google.com https://single-planet-426007-c7.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
  };
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...securityHeaders("application/json; charset=utf-8"), ...extraHeaders },
  });
}

function trustedClientOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (origin === url.origin || origin === GITHUB_PAGES_ORIGIN) return origin;
  if (origin) return null;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  const refererOrigin = new URL(referer).origin;
  return refererOrigin === url.origin || refererOrigin === GITHUB_PAGES_ORIGIN ? refererOrigin : null;
}

function tokenCorsHeaders(origin, url) {
  if (origin !== GITHUB_PAGES_ORIGIN || origin === url.origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function clientAddress(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function consumeTokenAllowance(request) {
  const now = Date.now();
  const key = clientAddress(request);
  const current = tokenWindows.get(key);
  if (!current || now - current.startedAt >= TOKEN_WINDOW_MS) {
    tokenWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= TOKEN_LIMIT) return false;
  current.count += 1;
  return true;
}

async function createGeminiToken(request, env, url) {
  const clientOrigin = trustedClientOrigin(request, url);
  if (!clientOrigin) return json({ error: "This token endpoint only accepts requests from Mira." }, 403);
  const corsHeaders = tokenCorsHeaders(clientOrigin, url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...securityHeaders("text/plain; charset=utf-8"), ...corsHeaders } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, corsHeaders);
  if (!consumeTokenAllowance(request)) return json({ error: "Too many connection attempts. Please wait a few minutes." }, 429, corsHeaders);
  if (!env.GEMINI_API_KEY) return json({ error: "Gemini is not configured yet." }, 503, corsHeaders);

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
  });

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502;
    return json({ error: status === 429 ? "The free Gemini quota is resting. Please try again later." : "Gemini could not open a secure session." }, status, corsHeaders);
  }

  const payload = await response.json();
  if (!payload.name) return json({ error: "Gemini returned an incomplete session token." }, 502, corsHeaders);
  return json({ token: payload.name, expiresAt: expireTime }, 200, corsHeaders);
}

function staticResponse(body, contentType, cacheControl) {
  return new Response(body, { headers: securityHeaders(contentType, cacheControl) });
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);

    if (url.pathname === "/api/gemini-token") return createGeminiToken(request, env, url);
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });

    let response;
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response = staticResponse(decodeText(HTML_B64), "text/html; charset=utf-8", "no-cache");
    } else if (url.pathname === "/styles.css") {
      response = staticResponse(decodeText(CSS_B64), "text/css; charset=utf-8", "no-cache");
    } else if (url.pathname === "/app.js") {
      response = staticResponse(decodeText(JS_B64), "text/javascript; charset=utf-8", "no-cache");
    } else if (url.pathname === "/assets/mira-avatar.png") {
      response = staticResponse(decodeBytes(AVATAR_B64), "image/png", "public, max-age=86400");
    } else {
      response = new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
    }

    if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
    return response;
  },
};
