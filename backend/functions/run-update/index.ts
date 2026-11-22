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

  // 1. who is calling? Ask Supabase Auth to validate the user's access token.
  //    (works with both the new publishable keys and legacy anon keys)
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey },
  });
  const user = who.ok ? await who.json() : null;
  if (!token || !user?.id) {
    console.log("run-update: not logged in, auth status", who.status);
    return json({ error: "not_logged_in" }, 401, headers);
  }
  console.log("run-update: user ok");

  if (!Deno.env.get("GITHUB_TOKEN")) return json({ error: "not_configured" }, 503, headers);

  // 2. already queued or running? then don't start another one
  for (const status of ["queued", "in_progress"]) {
    const r = await github(`/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`);
    if (!r.ok) console.log("run-update: github runs check", r.status);
    if (r.ok && ((await r.json()).total_count ?? 0) > 0) return json({ status: "already_running" }, 200, headers);
  }

  // 3. start it
  const r = await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status === 204) {
    console.log("run-update: started");
    return json({ status: "started" }, 202, headers);
  }
  // log GitHub's own message (never the token) so the reason is visible in the function logs
  console.log("run-update: github dispatch failed", r.status, (await r.text()).slice(0, 200));
  return json({ error: "github", code: r.status }, 502, headers);
});
