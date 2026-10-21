// GET /api/me: the signed-in player's account: best scores, recent games and stats
import { getStore } from "./_lib/store.js";
import { getSessionUser } from "./_lib/auth.js";
import { handler, rejectBadRequest, sendJson, todayUtc } from "./_lib/http.js";

const HISTORY_LENGTH = 20;

// Consecutive days with a daily challenge played, ending today or yesterday (UTC)
export function dailyStreak(days, today = todayUtc()) {
  const played = new Set(days);
  const date = new Date(`${today}T00:00:00Z`);
  if (!played.has(today)) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  let streak = 0;
  while (played.has(date.toISOString().slice(0, 10))) {
    streak += 1;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return streak;
}

export default handler(async (req, res) => {
  if (rejectBadRequest(req, res, "GET")) {
    return;
  }
  const user = await getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Not signed in" });
    return;
  }
  const store = getStore();
  const [stats, bests, dailyDays, history] = await Promise.all([
    store.playerStats(user.id),
    store.playerBests(user.id),
    store.playerDailyDates(user.id),
    store.playerHistory(user.id, HISTORY_LENGTH),
  ]);
  sendJson(res, 200, {
    user: { name: user.name, email: user.email },
    stats: { ...stats, dailyStreak: dailyStreak(dailyDays) },
    bests,
    history: history.map(({ board, score, level, ticks, created_at: createdAt }) => ({
      board, score, level, seconds: Math.round(ticks / 60), playedAt: new Date(createdAt).toISOString(),
    })),
  });
});
