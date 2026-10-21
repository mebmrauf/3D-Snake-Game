// GET /api/leaderboard?board=MEDIUM (or EASY, HARD, DAILY for today, DAILY-YYYY-MM-DD)
import { getStore } from "./_lib/store.js";
import { handler, queryParam, rejectBadRequest, sendJson, todayUtc } from "./_lib/http.js";

const BOARD_PATTERN = /^(EASY|MEDIUM|HARD|DAILY-\d{4}-\d{2}-\d{2})$/;
const TOP_COUNT = 10;

export default handler(async (req, res) => {
  if (rejectBadRequest(req, res, "GET")) {
    return;
  }
  let board = queryParam(req, "board");
  if (board === "DAILY") {
    board = `DAILY-${todayUtc()}`;
  }
  if (typeof board !== "string" || !BOARD_PATTERN.test(board)) {
    sendJson(res, 400, { error: "Unknown leaderboard" });
    return;
  }
  const rows = await getStore().topScores(board, TOP_COUNT);
  const scores = rows.map(({ name, score }) => ({ name, score }));
  // Shared by everyone, so Vercel's cache can answer most requests without the database
  sendJson(res, 200, { board, scores }, "public, s-maxage=10, stale-while-revalidate=30");
});
