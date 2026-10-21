// POST /api/run: starts a game. The server picks the board seed, so a player can't
// shop for an easy board, and remembers it to replay the game when a score comes in.
import { randomInt, randomUUID } from "node:crypto";
import { DIFFICULTIES, DAILY_DIFFICULTY, dailySeed } from "../web/js/logic.js";
import { getStore } from "./_lib/store.js";
import { clientIpHash, handler, readBody, rejectBadRequest, sendJson, todayUtc } from "./_lib/http.js";

const MAX_RUNS_PER_10_MINUTES = 60;

export default handler(async (req, res) => {
  if (rejectBadRequest(req, res, "POST")) {
    return;
  }
  const body = readBody(req);
  const mode = body && (body.mode === "classic" || body.mode === "daily") ? body.mode : null;
  const difficulty = mode === "daily" ? DAILY_DIFFICULTY : body && body.difficulty;
  if (!mode || !Object.hasOwn(DIFFICULTIES, String(difficulty))) {
    sendJson(res, 400, { error: "Invalid game settings" });
    return;
  }

  const store = getStore();
  const ipHash = clientIpHash(req);
  if (await store.countRecentRuns(ipHash) >= MAX_RUNS_PER_10_MINUTES) {
    sendJson(res, 429, { error: "Too many games started. Please wait a few minutes." });
    return;
  }

  const date = todayUtc();
  const seed = mode === "daily" ? dailySeed(date) : randomInt(0, 0x100000000);
  const board = mode === "daily" ? `DAILY-${date}` : difficulty;
  const runId = randomUUID();
  await store.createRun({ id: runId, seed, mode, difficulty, board, ipHash });
  await store.deleteStaleRuns();
  sendJson(res, 200, { runId, seed, mode, difficulty, board, date });
});
