// Shared request helpers for the leaderboard API. Files in api/_lib are not routes.
import { createHmac } from "node:crypto";

export function sendJson(res, status, body, cacheControl = "no-store") {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

// Wraps a handler so unexpected errors never leak details (or secrets) to players
export function handler(run) {
  return async (req, res) => {
    try {
      await run(req, res);
    } catch (error) {
      console.error("Leaderboard API error:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Something went wrong. Please try again later." });
      }
    }
  };
}

// Rejects wrong methods, other websites calling the API from a browser, and non-JSON posts
export function rejectBadRequest(req, res, method) {
  if (req.method !== method) {
    res.setHeader("Allow", method);
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }
  const origin = req.headers.origin;
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === req.headers.host;
    } catch {
      sameSite = false;
    }
    if (!sameSite) {
      sendJson(res, 403, { error: "Forbidden" });
      return true;
    }
  }
  if (method === "POST" && !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { error: "Send JSON" });
    return true;
  }
  return false;
}

// Returns the JSON body as a plain object, or null
export function readBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

export function queryParam(req, name) {
  if (req.query && typeof req.query[name] === "string") {
    return req.query[name];
  }
  const value = new URL(req.url, "http://localhost").searchParams.get(name);
  return value === null ? undefined : value;
}

// Players are rate-limited by IP address, but only a keyed hash of it is ever stored
export function clientIpHash(req) {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("IP_HASH_SECRET is missing or too short");
  }
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = String(req.headers["x-real-ip"] || "").trim() || forwarded || req.socket?.remoteAddress || "unknown";
  return createHmac("sha256", secret).update(ip).digest("hex");
}

// Today's date in UTC; the daily challenge changes at midnight UTC for everyone
export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
