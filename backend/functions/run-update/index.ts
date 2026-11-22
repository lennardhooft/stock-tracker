// Supabase Edge Function "run-update": the app's "Update now" button.
//
// Starts the daily scoring workflow on GitHub (e.g. right after adding a stock).
// - Only a logged-in user of this project may call it (sign-ups are off, so: the owner).
// - The GitHub token lives ONLY in this function's secrets (GITHUB_TOKEN), never in the app.
//   It should be a fine-grained token for this one repository with "Actions: read and write".
// - If an update is already queued or running, nothing new is started.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name "run-update",
// paste this file. Secret: Edge Functions → Secrets → GITHUB_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const REPO = "lennardhooft/stock-tracker"; // public repo name, not a secret
const WORKFLOW = "daily.yml";
const ALLOWED_ORIGINS = ["https://stock-tracker-dgz.pages.dev", "http://localhost:8000"];

function cors(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".stock-tracker-dgz.pages.dev"))
    ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function github(path: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${Deno.env.get("GITHUB_TOKEN")}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bottom-tracker-run-update",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method" }, 405, headers);

  // 1. who is calling? (the platform already checked the JWT; double-check the user exists)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return json({ error: "not_logged_in" }, 401, headers);

  if (!Deno.env.get("GITHUB_TOKEN")) return json({ error: "not_configured" }, 503, headers);

  // 2. already queued or running? then don't start another one
  for (const status of ["queued", "in_progress"]) {
    const r = await github(`/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`);
    if (r.ok && ((await r.json()).total_count ?? 0) > 0) return json({ status: "already_running" }, 200, headers);
  }

  // 3. start it
  const r = await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status === 204) return json({ status: "started" }, 202, headers);
  return json({ error: "github", code: r.status }, 502, headers);
});
