// POST /api/score: saves a finished game to the signed-in player's account. The score
// sent by the browser is never trusted: the server replays the game from its own seed
// and the recorded inputs, and the player comes from the Neon Auth session.
import { replayGame, TICKS_PER_SECOND } from "../web/js/logic.js";
import { getStore } from "./_lib/store.js";
import { getSessionUser } from "./_lib/auth.js";
import { cleanName } from "./_lib/names.js";
import { handler, readBody, rejectBadRequest, sendJson } from "./_lib/http.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INPUTS = 20000;
const MAX_RUN_AGE_SECONDS = 3 * 60 * 60;
// A game can't be submitted sooner than it takes to play (small allowance for clock jitter)
const MIN_REAL_TIME_RATIO = 0.9;

export default handler(async (req, res) => {
  if (rejectBadRequest(req, res, "POST")) {
    return;
  }
  const user = await getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Sign in to save your score" });
    return;
  }
  const body = readBody(req);
  const runId = body && typeof body.runId === "string" && UUID_PATTERN.test(body.runId) ? body.runId.toLowerCase() : null;
  if (!runId) {
    sendJson(res, 400, { error: "Invalid submission" });
    return;
  }
  const { inputs, finalTick, score } = body;
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS || !Number.isInteger(finalTick) || !Number.isInteger(score)) {
    sendJson(res, 400, { error: "Invalid submission" });
    return;
  }

  const store = getStore();
  const run = await store.findOpenRun(runId);
  if (!run) {
    sendJson(res, 404, { error: "This game was not found or was already saved" });
    return;
  }
  if (run.ageSeconds > MAX_RUN_AGE_SECONDS) {
    sendJson(res, 410, { error: "This game is too old to save" });
    return;
  }
  if (run.ageSeconds < (finalTick / TICKS_PER_SECOND) * MIN_REAL_TIME_RATIO) {
    sendJson(res, 422, { error: "This score couldn't be verified" });
    return;
  }

  const result = replayGame({ difficulty: run.difficulty, mode: run.mode, seed: run.seed, inputs, finalTick });
  if (!result.ok || result.score !== score) {
    sendJson(res, 422, { error: "This score couldn't be verified" });
    return;
  }
  if (!await store.claimRun(runId)) {
    sendJson(res, 409, { error: "This game was already saved" });
    return;
  }
  const previousBest = await store.bestScore(user.id, run.board);
  await store.insertScore({
    runId,
    userId: user.id,
    board: run.board,
    name: cleanName(user.name) || "Player",
    score: result.score,
    level: result.level,
    apples: result.apples,
    ticks: result.tick,
  });
  const rank = result.score > 0 ? await store.rankOf(run.board, Math.max(result.score, previousBest)) : null;
  sendJson(res, 200, { board: run.board, score: result.score, rank, personalBest: result.score > previousBest });
});
