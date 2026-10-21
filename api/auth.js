// /api/auth/<action>: forwards sign-up, sign-in, sign-out and session checks to Neon Auth.
// Going through this site makes Neon Auth's session cookie first-party, so browsers that
// block third-party cookies (Safari) keep players signed in. Only these four actions are
// forwarded, with only the fields they need.
import { authBaseUrl, clientIp, siteOrigin } from "./_lib/auth.js";
import { cleanName } from "./_lib/names.js";
import { handler, queryParam, readBody, rejectBadRequest, sendJson } from "./_lib/http.js";

const ACTIONS = {
  "sign-up/email": { method: "POST", fields: ["email", "password", "name"] },
  "sign-in/email": { method: "POST", fields: ["email", "password", "rememberMe"] },
  "sign-out": { method: "POST", fields: [] },
  "get-session": { method: "GET", fields: [] },
};
const UPSTREAM_TIMEOUT_MS = 8000;

// Neon Auth's cookies become host-only cookies of this site
export function rewriteSetCookie(cookie) {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/^domain=/i.test(part))
    .map((part) => (/^samesite=/i.test(part) ? "SameSite=Lax" : part))
    .join("; ");
}

export default handler(async (req, res) => {
  const action = ACTIONS[queryParam(req, "path")];
  if (!action) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  if (rejectBadRequest(req, res, action.method)) {
    return;
  }

  let body;
  if (action.method === "POST") {
    const input = readBody(req) || {};
    body = {};
    for (const field of action.fields) {
      if (input[field] !== undefined) {
        body[field] = input[field];
      }
    }
    if (typeof body.email === "string") {
      body.email = body.email.trim().toLowerCase();
    }
    if (action.fields.includes("name")) {
      // Player names appear on the public leaderboard, so they follow the same rules as before
      const name = cleanName(body.name);
      if (!name) {
        sendJson(res, 400, { error: "Use 1 to 16 letters, numbers, spaces, _ . or -", code: "INVALID_NAME" });
        return;
      }
      body.name = name;
    }
  }

  const headers = { origin: siteOrigin(req), "x-forwarded-for": clientIp(req) };
  if (req.headers.cookie) {
    headers.cookie = req.headers.cookie;
  }
  if (body) {
    headers["content-type"] = "application/json";
  }
  const upstream = await fetch(`${authBaseUrl()}/${queryParam(req, "path")}`, {
    method: action.method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  const cookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (cookies.length) {
    res.setHeader("Set-Cookie", cookies.map(rewriteSetCookie));
  }
  const text = await upstream.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!upstream.ok) {
    // Pass on Neon Auth's own message (e.g. "Invalid email or password"), nothing else
    const message = data && typeof data.message === "string" ? data.message : "Sign-in failed";
    sendJson(res, upstream.status >= 500 ? 502 : upstream.status, { error: message, code: data && data.code });
    return;
  }
  // Only the public parts of the account go back to the page
  const user = data && data.user ? { name: data.user.name, email: data.user.email } : null;
  sendJson(res, 200, { user });
});
