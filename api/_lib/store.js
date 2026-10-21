// All database access for the leaderboard and accounts. Every query uses parameters
// (tagged templates), so player input can never change the SQL itself.
import { neon } from "@neondatabase/serverless";

let store = null;

// Neon's pooled address suits many short serverless requests; fall back to the direct one
export function databaseUrl() {
  return process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
}

function createNeonStore() {
  const url = databaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL_POOLED or DATABASE_URL is not set");
  }
  const sql = neon(url);
  return {
    async countRecentRuns(ipHash) {
      const [row] = await sql`select count(*)::int as count from runs where ip_hash = ${ipHash} and created_at > now() - interval '10 minutes'`;
      return row.count;
    },
    async createRun({ id, seed, mode, difficulty, board, ipHash }) {
      await sql`insert into runs (id, seed, mode, difficulty, board, ip_hash) values (${id}, ${seed}, ${mode}, ${difficulty}, ${board}, ${ipHash})`;
    },
    async deleteStaleRuns() {
      await sql`delete from runs where submitted = false and created_at < now() - interval '1 day'`;
    },
    async findOpenRun(id) {
      const [row] = await sql`
        select id, seed, mode, difficulty, board, extract(epoch from (now() - created_at))::float8 as age_seconds
        from runs where id = ${id} and submitted = false`;
      return row ? { ...row, seed: Number(row.seed), ageSeconds: Number(row.age_seconds) } : null;
    },
    // Marks a run as used; only one request can ever succeed, so a game can't be submitted twice
    async claimRun(id) {
      const rows = await sql`update runs set submitted = true where id = ${id} and submitted = false returning id`;
      return rows.length === 1;
    },
    async bestScore(userId, board) {
      const [row] = await sql`select coalesce(max(score), 0)::int as best from scores where user_id = ${userId} and board = ${board}`;
      return row.best;
    },
    async insertScore({ runId, userId, board, name, score, level, apples, ticks }) {
      await sql`
        insert into scores (run_id, user_id, board, name, score, level, apples, ticks)
        values (${runId}, ${userId}, ${board}, ${name}, ${score}, ${level}, ${apples}, ${ticks})`;
    },
    // Rank among players, each counted once by their best score on this board
    async rankOf(board, score) {
      const [row] = await sql`
        select count(*)::int + 1 as rank
        from (select max(score) as best from scores where board = ${board} group by user_id) bests
        where best > ${score}`;
      return row.rank;
    },
    async topScores(board, limit) {
      return sql`
        select name, score from (
          select distinct on (user_id) user_id, name, score, created_at
          from scores where board = ${board} and score > 0
          order by user_id, score desc, created_at asc
        ) best
        order by score desc, created_at asc
        limit ${limit}`;
    },
    async playerStats(userId) {
      const [row] = await sql`
        select count(*)::int as games, coalesce(sum(apples), 0)::int as apples, coalesce(max(level), 0)::int as best_level
        from scores where user_id = ${userId}`;
      return { games: row.games, apples: row.apples, bestLevel: row.best_level };
    },
    async playerBests(userId) {
      const rows = await sql`
        select board, max(score)::int as best from scores
        where user_id = ${userId} and board in ('EASY', 'MEDIUM', 'HARD') group by board`;
      return Object.fromEntries(rows.map((row) => [row.board, row.best]));
    },
    async playerDailyDates(userId) {
      const rows = await sql`
        select distinct substring(board from 7) as day from scores
        where user_id = ${userId} and board like 'DAILY-%' order by day desc limit 400`;
      return rows.map((row) => row.day);
    },
    async playerHistory(userId, limit) {
      return sql`
        select board, score, level, apples, ticks, created_at from scores
        where user_id = ${userId} order by created_at desc limit ${limit}`;
    },
  };
}

export function getStore() {
  if (!store) {
    store = createNeonStore();
  }
  return store;
}

// Tests swap in an in-memory store instead of a real database
export function setStoreForTests(testStore) {
  store = testStore;
}
