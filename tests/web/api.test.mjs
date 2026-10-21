import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Game, seededRandom, dailySeed, TICKS_PER_SECOND } from "../../web/js/logic.js";
import { setStoreForTests } from "../../api/_lib/store.js";
import { setSessionResolverForTests } from "../../api/_lib/auth.js";
import { cleanName } from "../../api/_lib/names.js";
import startRun from "../../api/run.js";
import submitScore from "../../api/score.js";
import leaderboard from "../../api/leaderboard.js";
import me, { dailyStreak } from "../../api/me.js";
import authProxy, { rewriteSetCookie } from "../../api/auth.js";

process.env.IP_HASH_SECRET = "test-secret-that-is-long-enough-for-hmac-keys";
process.env.NEON_AUTH_BASE_URL = "https://auth.example/neondb/auth";

const PLAYERS = {
  rauf: { id: "user-rauf", name: "Rauf", email: "rauf@example.com" },
  mitu: { id: "user-mitu", name: "মিতু", email: "mitu@example.com" },
};

// In-memory stand-in for the Neon database, with the same behaviour the API relies on
function createMemoryStore() {
  const runs = new Map();
  const scores = [];
  const bestsByPlayer = (board) => {
    const bests = new Map();
    for (const entry of scores.filter((row) => row.board === board)) {
      if (!bests.has(entry.userId) || entry.score > bests.get(entry.userId).score) {
        bests.set(entry.userId, entry);
      }
    }
    return [...bests.values()];
  };
  return {
    runs,
    scores,
    async countRecentRuns(ipHash) {
      return [...runs.values()].filter((run) => run.ipHash === ipHash).length;
    },
    async createRun(run) {
      runs.set(run.id, { ...run, createdAt: Date.now(), submitted: false, ageOffset: 0 });
    },
    async deleteStaleRuns() {},
    async findOpenRun(id) {
      const run = runs.get(id);
      return run && !run.submitted ? { ...run, ageSeconds: (Date.now() - run.createdAt) / 1000 + run.ageOffset } : null;
    },
    async claimRun(id) {
      const run = runs.get(id);
      if (!run || run.submitted) {
        return false;
      }
      run.submitted = true;
      return true;
    },
    async bestScore(userId, board) {
      return Math.max(0, ...scores.filter((row) => row.userId === userId && row.board === board).map((row) => row.score));
    },
    async insertScore(score) {
      scores.push({ ...score, createdAt: new Date() });
    },
    async rankOf(board, score) {
      return bestsByPlayer(board).filter((entry) => entry.score > score).length + 1;
    },
    async topScores(board, limit) {
      return bestsByPlayer(board).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
        .map(({ name, score }) => ({ name, score }));
    },
    async playerStats(userId) {
      const mine = scores.filter((row) => row.userId === userId);
      return { games: mine.length, apples: mine.reduce((sum, row) => sum + row.apples, 0), bestLevel: Math.max(0, ...mine.map((row) => row.level)) };
    },
    async playerBests(userId) {
      const bests = {};
      for (const row of scores.filter((entry) => entry.userId === userId && !entry.board.startsWith("DAILY"))) {
        bests[row.board] = Math.max(bests[row.board] || 0, row.score);
      }
      return bests;
    },
    async playerDailyDates(userId) {
      return [...new Set(scores.filter((row) => row.userId === userId && row.board.startsWith("DAILY-")).map((row) => row.board.slice(6)))];
    },
    async playerHistory(userId, limit) {
      return scores.filter((row) => row.userId === userId).reverse().slice(0, limit)
        .map(({ board, score, level, apples, ticks, createdAt }) => ({ board, score, level, apples, ticks, created_at: createdAt }));
    },
  };
}

let store;
const realFetch = globalThis.fetch;

beforeEach(() => {
  store = createMemoryStore();
  setStoreForTests(store);
  // Requests carry a test header saying who is signed in; no header means a guest
  setSessionResolverForTests(async (req) => PLAYERS[req.headers["x-test-player"]] || null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function call(handler, { method = "POST", body, query = {}, headers = {}, player } = {}) {
  const req = {
    method,
    body,
    query,
    url: "/api/test",
    headers: { host: "snake.example", "content-type": "application/json", "x-real-ip": "203.0.113.7", ...headers },
  };
  if (player) {
    req.headers["x-test-player"] = player;
  }
  const response = { statusCode: 200, headers: {}, body: "" };
  const res = {
    headersSent: false,
    get statusCode() { return response.statusCode; },
    set statusCode(value) { response.statusCode = value; },
    setHeader(name, value) { response.headers[name.toLowerCase()] = value; },
    end(text) { response.body = text; this.headersSent = true; },
  };
  await handler(req, res);
  return { status: response.statusCode, headers: response.headers, json: response.body ? JSON.parse(response.body) : null };
}

// Plays honestly with a simple autopilot that heads for the apple using normal turns,
// then gives up after `appleTarget` apples by turning in circles until it crashes
function playGame(seed, difficulty, mode = "classic", appleTarget = 3) {
  const game = new Game(difficulty, seededRandom(seed), mode);
  const size = 14;
  const distance = (a, b) => Math.min(Math.abs(a - b), size - Math.abs(a - b));
  for (let frame = 0; frame < 200000 && !game.isFinished(); frame++) {
    if (!game.directionQueue.length && game.countdown === 0) {
      const giveUp = game.applesEaten >= appleTarget || !game.food;
      const target = giveUp ? game.obstacles[0] : game.food;
      if (!target) {
        game.turn("left");
      } else {
        const [headX, headY] = game.snake[0];
        // Heading for the apple avoids everything; giving up heads straight into a block
        const blocked = new Set([...(giveUp ? [] : game.obstacles), ...game.bombs, ...game.snake.slice(0, -1)].map(([x, y]) => `${x},${y}`));
        const [currentX, currentY] = game.direction;
        const options = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .filter(([dx, dy]) => !(dx === -currentX && dy === -currentY))
          .map(([dx, dy]) => {
            const next = [(headX + dx + size) % size, (headY + dy + size) % size];
            return { dx, dy, safe: !blocked.has(`${next[0]},${next[1]}`), away: distance(next[0], target[0]) + distance(next[1], target[1]) };
          })
          .filter((option) => option.safe)
          .sort((a, b) => a.away - b.away);
        if (options.length && (options[0].dx !== currentX || options[0].dy !== currentY)) {
          game.queueDirection([options[0].dx, options[0].dy]);
        }
      }
    }
    game.update(1 / 60);
  }
  return { inputs: game.inputs, finalTick: game.tick, score: game.score };
}

// Starts a game on the server and plays it honestly; minScore picks a game that scores
async function startAndPlay({ difficulty = "MEDIUM", mode = "classic", minScore = 1, maxScore = Infinity } = {}) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const started = await call(startRun, { body: { mode, difficulty }, headers: { "x-real-ip": `198.51.100.${attempt}` } });
    assert.equal(started.status, 200);
    const appleTarget = Number.isFinite(maxScore) ? maxScore : Math.max(minScore, 3);
    const played = playGame(started.json.seed, started.json.difficulty, mode, appleTarget);
    if (played.score >= minScore && played.score <= maxScore) {
      // Pretend the real time it took to play has passed
      store.runs.get(started.json.runId).ageOffset = played.finalTick / TICKS_PER_SECOND;
      return { runId: started.json.runId, ...played };
    }
  }
  throw new Error("no suitable game found");
}

test("starting a game returns a server-chosen seed", async () => {
  const { status, json } = await call(startRun, { body: { mode: "classic", difficulty: "HARD" } });
  assert.equal(status, 200);
  assert.ok(Number.isInteger(json.seed));
  assert.equal(json.board, "HARD");
  assert.equal(store.runs.get(json.runId).seed, json.seed);
});

test("the daily challenge uses today's shared seed on Medium", async () => {
  const { json } = await call(startRun, { body: { mode: "daily", difficulty: "HARD" } });
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(json.difficulty, "MEDIUM");
  assert.equal(json.board, `DAILY-${today}`);
  assert.equal(json.seed, dailySeed(today));
});

test("bad requests are rejected", async () => {
  assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "INSANE" } })).status, 400);
  assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "constructor" } })).status, 400);
  assert.equal((await call(startRun, { method: "GET" })).status, 405);
  assert.equal((await call(startRun, { body: {}, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "EASY" }, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "EASY" }, headers: { origin: "https://snake.example" } })).status, 200);
});

test("starting too many games from one address is rate-limited", async () => {
  for (let i = 0; i < 60; i++) {
    assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "EASY" } })).status, 200);
  }
  assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "EASY" } })).status, 429);
  assert.equal((await call(startRun, { body: { mode: "classic", difficulty: "EASY" }, headers: { "x-real-ip": "198.51.100.2" } })).status, 200);
});

test("IP addresses are stored only as keyed hashes", async () => {
  const { json } = await call(startRun, { body: { mode: "classic", difficulty: "EASY" } });
  const { ipHash } = store.runs.get(json.runId);
  assert.match(ipHash, /^[0-9a-f]{64}$/);
  assert.ok(!ipHash.includes("203.0.113.7"));
});

test("guests can't save scores", async () => {
  const game = await startAndPlay();
  const { status } = await call(submitScore, { body: game });
  assert.equal(status, 401);
  assert.equal(store.scores.length, 0);
  // The game is still open, so the player can sign in and save it
  assert.equal((await call(submitScore, { body: game, player: "rauf" })).status, 200);
});

test("a signed-in player's honest game is verified and saved to their account", async () => {
  const game = await startAndPlay();
  const { status, json } = await call(submitScore, { body: { ...game, name: "Impostor", userId: "user-mitu" }, player: "rauf" });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.score, game.score);
  assert.equal(json.rank, 1);
  assert.equal(json.personalBest, true);
  // Name and account come from the session, never from the request body
  assert.equal(store.scores[0].userId, "user-rauf");
  assert.equal(store.scores[0].name, "Rauf");
  const board = await call(leaderboard, { method: "GET", query: { board: "MEDIUM" } });
  assert.deepEqual(board.json.scores, [{ name: "Rauf", score: game.score }]);
});

test("the leaderboard shows each player once, with their best score", async () => {
  const low = await startAndPlay({ minScore: 1, maxScore: 1 });
  const high = await startAndPlay({ minScore: 2 });
  await call(submitScore, { body: high, player: "rauf" });
  const second = await call(submitScore, { body: low, player: "rauf" });
  assert.equal(second.json.personalBest, false);
  const other = await startAndPlay({ minScore: 1, maxScore: 1 });
  const mitu = await call(submitScore, { body: other, player: "mitu" });
  assert.equal(mitu.json.rank, 2);
  const board = await call(leaderboard, { method: "GET", query: { board: "MEDIUM" } });
  assert.deepEqual(board.json.scores.map((row) => row.name), ["Rauf", "মিতু"]);
  assert.equal(board.json.scores[0].score, high.score);
});

test("zero-point games go to history but not the leaderboard", async () => {
  const game = await startAndPlay({ minScore: 0, maxScore: 0 });
  const { status, json } = await call(submitScore, { body: game, player: "rauf" });
  assert.equal(status, 200);
  assert.equal(json.rank, null);
  assert.equal((await call(leaderboard, { method: "GET", query: { board: "MEDIUM" } })).json.scores.length, 0);
  assert.equal((await call(me, { method: "GET", player: "rauf" })).json.stats.games, 1);
});

test("the same game can't be saved twice", async () => {
  const game = await startAndPlay();
  assert.equal((await call(submitScore, { body: game, player: "rauf" })).status, 200);
  assert.equal((await call(submitScore, { body: game, player: "rauf" })).status, 404);
  assert.equal((await call(submitScore, { body: game, player: "mitu" })).status, 404);
  assert.equal(store.scores.length, 1);
});

test("faked scores are rejected", async () => {
  const game = await startAndPlay();
  assert.equal((await call(submitScore, { body: { ...game, score: game.score + 50 }, player: "rauf" })).status, 422);
  assert.equal((await call(submitScore, { body: { ...game, finalTick: game.finalTick + 600 }, player: "rauf" })).status, 422);
  assert.equal((await call(submitScore, { body: { ...game, inputs: [[3, 0, 1]] }, player: "rauf" })).status, 422);
  assert.equal(store.scores.length, 0);
});

test("a game submitted faster than it could be played is rejected", async () => {
  const game = await startAndPlay();
  store.runs.get(game.runId).ageOffset = 0;
  assert.equal((await call(submitScore, { body: game, player: "rauf" })).status, 422);
});

test("malformed submissions are rejected", async () => {
  const valid = await startAndPlay();
  assert.equal((await call(submitScore, { body: { ...valid, runId: "not-a-uuid" }, player: "rauf" })).status, 400);
  assert.equal((await call(submitScore, { body: { ...valid, inputs: "x" }, player: "rauf" })).status, 400);
  assert.equal((await call(submitScore, { body: { ...valid, inputs: new Array(20001).fill([1, 1, 0]) }, player: "rauf" })).status, 400);
  assert.equal((await call(submitScore, { body: "{not json", player: "rauf" })).status, 400);
});

test("the account page shows stats, bests, history and the daily streak", async () => {
  assert.equal((await call(me, { method: "GET" })).status, 401);
  const classic = await startAndPlay({ difficulty: "EASY" });
  await call(submitScore, { body: classic, player: "rauf" });
  const daily = await startAndPlay({ mode: "daily", minScore: 0 });
  await call(submitScore, { body: daily, player: "rauf" });
  const { status, json } = await call(me, { method: "GET", player: "rauf" });
  assert.equal(status, 200);
  assert.deepEqual(json.user, { name: "Rauf", email: "rauf@example.com" });
  assert.equal(json.stats.games, 2);
  assert.equal(json.stats.dailyStreak, 1);
  assert.equal(json.bests.EASY, classic.score);
  assert.equal(json.history.length, 2);
  assert.ok(json.history.every((row) => "playedAt" in row && !("userId" in row)));
  // Another player sees only their own account
  assert.equal((await call(me, { method: "GET", player: "mitu" })).json.stats.games, 0);
});

test("daily streaks count consecutive days ending today or yesterday", () => {
  assert.equal(dailyStreak([], "2026-10-21"), 0);
  assert.equal(dailyStreak(["2026-10-21", "2026-10-20", "2026-10-19"], "2026-10-21"), 3);
  assert.equal(dailyStreak(["2026-10-20", "2026-10-19"], "2026-10-21"), 2);
  assert.equal(dailyStreak(["2026-10-21", "2026-10-19"], "2026-10-21"), 1);
  assert.equal(dailyStreak(["2026-10-18"], "2026-10-21"), 0);
  assert.equal(dailyStreak(["2026-03-01", "2026-02-28"], "2026-03-01"), 2);
});

test("names are checked", () => {
  assert.equal(cleanName("  Rauf   99 "), "Rauf 99");
  assert.equal(cleanName("রউফ"), "রউফ");
  assert.equal(cleanName("ab_c.d-e"), "ab_c.d-e");
  for (const bad of ["", "   ", "<script>", "a".repeat(17), "x\u0000y", "-dash", 42, null]) {
    assert.equal(cleanName(bad), null, String(bad));
  }
});

test("leaderboard boards are validated, and DAILY means today", async () => {
  assert.equal((await call(leaderboard, { method: "GET", query: { board: "users; drop table" } })).status, 400);
  const daily = await call(leaderboard, { method: "GET", query: { board: "DAILY" } });
  assert.equal(daily.json.board, `DAILY-${new Date().toISOString().slice(0, 10)}`);
});

test("server errors don't leak details", async () => {
  setStoreForTests({ topScores: async () => { throw new Error("password=hunter2 at db host"); } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const { status, json } = await call(leaderboard, { method: "GET", query: { board: "EASY" } });
    assert.equal(status, 500);
    assert.ok(!JSON.stringify(json).includes("hunter2"));
  } finally {
    console.error = originalError;
  }
});

// Fake Neon Auth: records what the proxy sends and answers like Better Auth
function fakeNeonAuth(reply) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), ...options, body: options.body ? JSON.parse(options.body) : undefined });
    const { status = 200, body, cookies = [] } = reply(String(url), options);
    const headers = new Headers({ "content-type": "application/json" });
    for (const cookie of cookies) {
      headers.append("set-cookie", cookie);
    }
    return new Response(JSON.stringify(body), { status, headers });
  };
  return calls;
}

test("the sign-in proxy only forwards allowed actions and fields", async () => {
  const calls = fakeNeonAuth(() => ({ body: { user: { id: "user-rauf", name: "Rauf", email: "rauf@example.com", emailVerified: false } } }));
  assert.equal((await call(authProxy, { query: { path: "admin/list-users" } })).status, 404);
  assert.equal((await call(authProxy, { query: { path: "../update-user" } })).status, 404);
  assert.equal((await call(authProxy, { method: "GET", query: { path: "sign-in/email" } })).status, 405);
  assert.equal(calls.length, 0);

  const { status, json } = await call(authProxy, {
    query: { path: "sign-up/email" },
    body: { email: " Rauf@Example.com ", password: "correct horse battery", name: "Rauf", role: "admin", image: "x" },
  });
  assert.equal(status, 200);
  assert.equal(calls[0].url, "https://auth.example/neondb/auth/sign-up/email");
  assert.deepEqual(calls[0].body, { email: "rauf@example.com", password: "correct horse battery", name: "Rauf" });
  assert.equal(calls[0].headers.origin, "https://snake.example");
  // Only public account details come back to the page
  assert.deepEqual(json, { user: { name: "Rauf", email: "rauf@example.com" } });
});

test("sign-up rejects names that can't go on the leaderboard", async () => {
  const calls = fakeNeonAuth(() => ({ body: {} }));
  const { status, json } = await call(authProxy, { query: { path: "sign-up/email" }, body: { email: "a@b.co", password: "long enough pw", name: "<img src=x>" } });
  assert.equal(status, 400);
  assert.equal(json.code, "INVALID_NAME");
  assert.equal(calls.length, 0);
});

test("Neon Auth's cookies become first-party cookies of this site", async () => {
  fakeNeonAuth(() => ({
    body: { user: { name: "Rauf", email: "rauf@example.com" } },
    cookies: ["__Secure-neonauth.session_token=abc; Domain=auth.example; Path=/; HttpOnly; Secure; SameSite=None"],
  }));
  const { headers } = await call(authProxy, { query: { path: "sign-in/email" }, body: { email: "rauf@example.com", password: "pw" } });
  assert.deepEqual(headers["set-cookie"], ["__Secure-neonauth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"]);
  assert.equal(rewriteSetCookie("a=1; domain=.x.com; samesite=none; Secure"), "a=1; SameSite=Lax; Secure");
});

test("sign-in errors pass on Neon Auth's message only", async () => {
  fakeNeonAuth(() => ({ status: 401, body: { message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD", stack: "secret" } }));
  const { status, json } = await call(authProxy, { query: { path: "sign-in/email" }, body: { email: "rauf@example.com", password: "wrong" } });
  assert.equal(status, 401);
  assert.deepEqual(json, { error: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" });
});
