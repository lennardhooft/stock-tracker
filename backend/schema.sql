-- Stock Bottom Tracker — Supabase schema (Phase 1)
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent).
--
-- Security model (CLAUDE.md 2.1 / 13.13.2):
--   * Row-level security is ON for every table.
--   * Personal tables: only rows with user_id = auth.uid() are visible to the logged-in owner.
--   * The daily job writes with the SERVICE key (GitHub Secret), which bypasses RLS.
--   * The anon role (not logged in) can read nothing.

-- ---------------------------------------------------------------------------
-- watchlist: edited by the owner in the app
-- ---------------------------------------------------------------------------
create table if not exists public.watchlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol      text not null check (symbol ~ '^[A-Za-z0-9.\-^=]{1,20}$'),
  name        text check (char_length(name) <= 100),
  market      text not null default 'US' check (market in ('US', 'EU', 'OTHER')),
  buy_below   numeric check (buy_below is null or buy_below > 0),
  notes       text check (char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  unique (user_id, symbol)
);

-- ---------------------------------------------------------------------------
-- latest_scores: one row per owner + ticker, overwritten by the daily job
-- ---------------------------------------------------------------------------
create table if not exists public.latest_scores (
  user_id            uuid not null references auth.users (id) on delete cascade,
  symbol             text not null,
  as_of              date,                 -- date of the last price bar used
  price              numeric,
  currency           text,
  change_pct         numeric,              -- % change vs previous close
  pct_from_52w_high  numeric,              -- negative number, e.g. -32.5
  high_52w           numeric,
  low_52w            numeric,
  score              numeric,
  max_score          numeric,
  n_na               integer,
  label              text,
  signals            jsonb,                -- per-signal raw values, thresholds, pass/fail/null
  sparkline          jsonb,                -- last ~52 weekly closes
  checks             jsonb,                -- data sanity check results
  suspect            boolean not null default false,
  error              text,                 -- short status if the ticker could not be scored
  updated_at         timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- ---------------------------------------------------------------------------
-- ticker_detail: heavier per-ticker data for the detail page
-- ---------------------------------------------------------------------------
create table if not exists public.ticker_detail (
  user_id     uuid not null references auth.users (id) on delete cascade,
  symbol      text not null,
  weekly      jsonb,                       -- {"t": [...dates], "c": [...closes], "sma200": [...]}
  updated_at  timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- ---------------------------------------------------------------------------
-- score_history: one snapshot per owner + ticker + day (chart comes in Phase 2)
-- ---------------------------------------------------------------------------
create table if not exists public.score_history (
  user_id    uuid not null references auth.users (id) on delete cascade,
  symbol     text not null,
  date       date not null,
  score      numeric,
  max_score  numeric,
  n_na       integer,
  price      numeric,
  primary key (user_id, symbol, date)
);

-- ---------------------------------------------------------------------------
-- market_snapshot: market-wide data (not personal) — readable by logged-in users
-- ---------------------------------------------------------------------------
create table if not exists public.market_snapshot (
  id          text primary key,            -- always 'latest'
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_runs: health page (13.14 E) — counts and statuses only, no tickers
-- ---------------------------------------------------------------------------
create table if not exists public.job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  status       text not null check (status in ('ok', 'partial', 'failed')),
  counts       jsonb,
  sources      jsonb
);
create index if not exists job_runs_job_started on public.job_runs (job, started_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.watchlist        enable row level security;
alter table public.latest_scores    enable row level security;
alter table public.ticker_detail    enable row level security;
alter table public.score_history    enable row level security;
alter table public.market_snapshot  enable row level security;
alter table public.job_runs         enable row level security;

-- watchlist: owner can read and write own rows
drop policy if exists watchlist_owner_all on public.watchlist;
create policy watchlist_owner_all on public.watchlist
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- generated tables: owner can read own rows only (writes come from the service key)
drop policy if exists latest_scores_owner_read on public.latest_scores;
create policy latest_scores_owner_read on public.latest_scores
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists ticker_detail_owner_read on public.ticker_detail;
create policy ticker_detail_owner_read on public.ticker_detail
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists score_history_owner_read on public.score_history;
create policy score_history_owner_read on public.score_history
  for select to authenticated using (user_id = (select auth.uid()));

-- non-personal tables: any logged-in user (sign-ups are disabled, so only the owner)
drop policy if exists market_snapshot_auth_read on public.market_snapshot;
create policy market_snapshot_auth_read on public.market_snapshot
  for select to authenticated using (true);

drop policy if exists job_runs_auth_read on public.job_runs;
create policy job_runs_auth_read on public.job_runs
  for select to authenticated using (true);
