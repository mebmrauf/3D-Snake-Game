// Talks to the leaderboard and account API (api/ on Vercel). Where there is no API, such as
// on GitHub Pages or offline, everything here quietly reports that it's unavailable.
const API_BASE = "/api";
const TIMEOUT_MS = 5000;

export class LeaderboardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new LeaderboardError(response.status, (data && data.error) || "Request failed");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

let availability = null;

export function isAvailable() {
  if (!availability) {
    availability = request("/leaderboard?board=EASY").then(() => true, () => false);
  }
  return availability;
}

export function startRun(mode, difficulty) {
  return request("/run", { method: "POST", body: JSON.stringify({ mode, difficulty }) });
}

export function submitScore({ runId, inputs, finalTick, score }) {
  return request("/score", { method: "POST", body: JSON.stringify({ runId, inputs, finalTick, score }) });
}

// Accounts (Neon Auth, reached through this site so the session cookie is first-party)
export async function getSessionUser() {
  try {
    return (await request("/auth/get-session")).user;
  } catch {
    return null;
  }
}

export function signUp({ name, email, password }) {
  return request("/auth/sign-up/email", { method: "POST", body: JSON.stringify({ name, email, password }) });
}

export function signIn({ email, password }) {
  return request("/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password, rememberMe: true }) });
}

export function signOut() {
  return request("/auth/sign-out", { method: "POST", body: "{}" });
}

export function myAccount() {
  return request("/me");
}

export function topScores(board) {
  return request(`/leaderboard?board=${encodeURIComponent(board)}`);
}
