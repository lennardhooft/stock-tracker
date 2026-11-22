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
-- Table privileges (newer Supabase projects do not grant these automatically)
--   service_role (daily job): read + write everything
--   authenticated (owner, further limited by RLS): read all, edit only the watchlist
--   anon (not logged in): nothing
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on
  public.watchlist, public.latest_scores, public.ticker_detail, public.score_history,
  public.market_snapshot, public.job_runs
  to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on
  public.watchlist, public.latest_scores, public.ticker_detail, public.score_history,
  public.market_snapshot, public.job_runs
  to authenticated;
grant insert, update, delete on public.watchlist to authenticated;
revoke all on
  public.watchlist, public.latest_scores, public.ticker_detail, public.score_history,
  public.market_snapshot, public.job_runs
  from anon;

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

-- ===========================================================================
-- Phase 2B: alerts (CLAUDE.md 7.2)
-- ===========================================================================
-- alert_state: de-duplication, one row per owner + ticker + kind + Brussels day.
-- Only the daily job (service key) uses it: RLS on, no policies, no grants for users.
create table if not exists public.alert_state (
  user_id  uuid not null references auth.users (id) on delete cascade,
  symbol   text not null,
  kind     text not null,
  day      date not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, symbol, kind, day)
);

-- alerts_log: every alert that was sent (or attempted), shown on More → Alerts.
create table if not exists public.alerts_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  symbol     text not null,
  kind       text not null,
  title      text not null,
  body       text,
  url        text,
  delivered  boolean not null default false,
  sent_at    timestamptz not null default now()
);
create index if not exists alerts_log_user_sent on public.alerts_log (user_id, sent_at desc);

alter table public.alert_state enable row level security;
alter table public.alerts_log  enable row level security;

drop policy if exists alerts_log_owner_read on public.alerts_log;
create policy alerts_log_owner_read on public.alerts_log
  for select to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.alert_state, public.alerts_log to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.alerts_log to authenticated;
revoke all on public.alert_state, public.alerts_log from anon;
revoke all on public.alert_state from authenticated;

-- ===========================================================================
-- Phase 2C: fundamentals, news and earnings (CLAUDE.md 6.2, 13.1, 13.3)
-- ===========================================================================
alter table public.ticker_detail add column if not exists fundamentals jsonb;   -- valuation, insiders, news, earnings
alter table public.latest_scores add column if not exists next_earnings jsonb;  -- {date, hour, eps_est, source}

-- ---------------------------------------------------------------------------
-- Phase 2E: Quality Score summary, Top Score and combined verdict per ticker.
-- (Full quality breakdown lives in ticker_detail.fundamentals → quality.)
-- ---------------------------------------------------------------------------
alter table public.latest_scores add column if not exists quality jsonb;   -- {score, label, moat, na, weak}
alter table public.latest_scores add column if not exists top jsonb;       -- {score, max_score, label, signals}
alter table public.latest_scores add column if not exists verdict text;    -- sale | check | trap | none

-- ---------------------------------------------------------------------------
-- Phase 2F: watchlist tags (CLAUDE.md 13.6), edited by the owner in the app.
-- ---------------------------------------------------------------------------
alter table public.watchlist add column if not exists tags text[] not null default '{}';
alter table public.watchlist drop constraint if exists watchlist_tags_check;
alter table public.watchlist add constraint watchlist_tags_check
  check (cardinality(tags) <= 8 and char_length(array_to_string(tags, ',')) <= 200);

-- ---------------------------------------------------------------------------
-- Phase 2G: calendar (CLAUDE.md 13.3)
-- ---------------------------------------------------------------------------
alter table public.latest_scores add column if not exists next_dividend jsonb;  -- {ex_date, pay_date, amount, currency, estimated}

-- one private calendar-feed secret per owner (the .ics link); owner-only via RLS
create table if not exists public.calendar_tokens (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token       text not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at  timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
drop policy if exists "owner reads own calendar token" on public.calendar_tokens;
create policy "owner reads own calendar token" on public.calendar_tokens
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owner creates own calendar token" on public.calendar_tokens;
create policy "owner creates own calendar token" on public.calendar_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "owner renews own calendar token" on public.calendar_tokens;
create policy "owner renews own calendar token" on public.calendar_tokens
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "owner deletes own calendar token" on public.calendar_tokens;
create policy "owner deletes own calendar token" on public.calendar_tokens
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.calendar_tokens to authenticated;
grant all on public.calendar_tokens to service_role;
revoke all on public.calendar_tokens from anon;

-- The calendar app (no login) asks the calendar-ics Edge Function; the function calls this with the
-- secret token. Returns only dates + tickers of that owner (no notes, levels or scores); NULL if unknown.
create or replace function public.calendar_feed(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with owner as (select user_id from public.calendar_tokens where token = p_token)
  select jsonb_build_object(
    'stocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'symbol', s.symbol, 'currency', s.currency,
        'earnings', s.next_earnings, 'dividend', s.next_dividend))
      from public.latest_scores s
      where s.user_id = (select user_id from owner)), '[]'::jsonb),
    'macro', coalesce((select data -> 'events' from public.market_snapshot where id = 'macro'), '[]'::jsonb))
  where exists (select 1 from owner);
$$;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated, service_role;

-- ===========================================================================
-- Phase 3A: portfolio & risk (CLAUDE.md 13.13). Personal money data:
-- readable/writable only by the owner AND only after the two-step login (aal2).
-- ===========================================================================
alter table public.watchlist add column if not exists asset_type text
  check (asset_type is null or asset_type in ('broad_etf','sector_etf','bond_etf','stock','speculative','crypto','other'));
alter table public.latest_scores add column if not exists risk jsonb;  -- {vol, atr, max_dd, sector, region, suggested_type, ...}

create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  symbol      text not null check (symbol ~ '^[A-Za-z0-9.\-^=]{1,20}$'),
  kind        text not null check (kind in ('buy', 'sell', 'start')),
  quantity    numeric not null check (quantity > 0),
  price       numeric not null check (price >= 0),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate     numeric check (fx_rate is null or fx_rate > 0),  -- units of `currency` per 1 EUR on that day
  fees        numeric not null default 0 check (fees >= 0),     -- in `currency`
  taxes       numeric not null default 0 check (taxes >= 0),    -- in `currency` (e.g. TOB)
  note        text check (char_length(note) <= 500),
  source      text not null default 'manual' check (source in ('manual', 'import')),
  created_at  timestamptz not null default now()
);
create index if not exists transactions_user_symbol on public.transactions (user_id, symbol, date);

create table if not exists public.portfolio_settings (
  user_id               uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  cash                  jsonb not null default '{}'::jsonb,   -- {"EUR": 4200, "USD": 300}
  emergency_fund        numeric not null default 0 check (emergency_fund >= 0),  -- EUR, excluded
  monthly_contribution  numeric check (monthly_contribution is null or monthly_contribution >= 0),
  updated_at            timestamptz not null default now()
);

create table if not exists public.risk_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  profile     text not null default 'balanced' check (profile in ('conservative', 'balanced', 'aggressive', 'custom')),
  settings    jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.risk_settings_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile     text not null,
  settings    jsonb not null,
  changed_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['transactions', 'portfolio_settings', 'risk_settings', 'risk_settings_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_mfa', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (user_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')
      with check (user_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2')$p$, t || '_owner_mfa', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- the settings log is append-only for the owner
revoke update, delete on public.risk_settings_log from authenticated;
