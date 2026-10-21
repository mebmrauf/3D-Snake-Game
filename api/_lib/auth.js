// Accounts are handled by Neon Auth. The browser talks to it only through this site
// (api/auth.js), so its session cookie is first-party and works in Safari too.

const SESSION_TIMEOUT_MS = 5000;

export function authBaseUrl() {
  const base = process.env.NEON_AUTH_BASE_URL;
  if (!base) {
    throw new Error("NEON_AUTH_BASE_URL is not set");
  }
  return base.replace(/\/+$/, "");
}

// This site's own origin, which Neon Auth checks against its trusted domains
export function siteOrigin(req) {
  const host = String(req.headers.host || "");
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const protocol = isLocal ? "http" : "https";
  return `${protocol}://${host}`;
}

export function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return String(req.headers["x-real-ip"] || "").trim() || forwarded || req.socket?.remoteAddress || "";
}

let testSessionResolver = null;

// Tests decide who is signed in without calling Neon Auth
export function setSessionResolverForTests(resolver) {
  testSessionResolver = resolver;
}

// Asks Neon Auth who is signed in, using the request's session cookie. The user id
// always comes from Neon Auth, never from anything the browser claims.
export async function getSessionUser(req) {
  if (testSessionResolver) {
    return testSessionResolver(req);
  }
  // The only cookies this site has are Neon Auth's own session cookies
  const cookie = req.headers.cookie;
  if (!cookie) {
    return null;
  }
  const response = await fetch(`${authBaseUrl()}/get-session`, {
    headers: { cookie, origin: siteOrigin(req), "x-forwarded-for": clientIp(req) },
    signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json().catch(() => null);
  if (!data || !data.user || !data.user.id) {
    return null;
  }
  return { id: String(data.user.id), name: String(data.user.name || ""), email: String(data.user.email || "") };
}
