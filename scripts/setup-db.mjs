// Creates the leaderboard tables in your Neon database. Safe to run more than once.
// Usage: npm run db:setup   (reads DATABASE_URL from .env)
import { neon } from "@neondatabase/serverless";

// Table changes go through the direct (not pooled) connection
const url = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env first (see .env.example).");
  process.exit(1);
}
const sql = neon(url);

// One row per game started; the server's seed lets it replay the game later
await sql`
  create table if not exists runs (
    id uuid primary key,
    seed bigint not null check (seed >= 0 and seed <= 4294967295),
    mode text not null check (mode in ('classic', 'daily')),
    difficulty text not null check (difficulty in ('EASY', 'MEDIUM', 'HARD')),
    board text not null check (board ~ '^(EASY|MEDIUM|HARD|DAILY-[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
    ip_hash text not null check (length(ip_hash) = 64),
    created_at timestamptz not null default now(),
    submitted boolean not null default false
  )`;
await sql`create index if not exists runs_ip_hash_created_at on runs (ip_hash, created_at)`;
await sql`create index if not exists runs_created_at on runs (created_at) where submitted = false`;

// One row per verified game of a signed-in player (their history); a game appears at most once.
// user_id is the Neon Auth user id.
await sql`
  create table if not exists scores (
    id bigint generated always as identity primary key,
    run_id uuid not null unique references runs (id),
    user_id text not null,
    board text not null,
    name text not null check (char_length(name) between 1 and 16),
    score integer not null check (score >= 0),
    level integer not null default 1 check (level >= 1),
    apples integer not null default 0 check (apples >= 0),
    ticks integer not null check (ticks > 0),
    created_at timestamptz not null default now()
  )`;
// Upgrades a table created by the first (account-less) version of this script
await sql`alter table scores add column if not exists user_id text`;
await sql`alter table scores add column if not exists level integer not null default 1`;
await sql`alter table scores add column if not exists apples integer not null default 0`;
await sql`delete from scores where user_id is null`;
await sql`alter table scores alter column user_id set not null`;
await sql`alter table scores drop constraint if exists scores_score_check`;
await sql`alter table scores add constraint scores_score_check check (score >= 0)`;
await sql`create index if not exists scores_board_score on scores (board, score desc, created_at)`;
await sql`create index if not exists scores_user_created_at on scores (user_id, created_at desc)`;
await sql`create index if not exists scores_board_user on scores (board, user_id, score desc)`;

console.log("Leaderboard tables are ready.");
