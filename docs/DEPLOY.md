# Going live

Two separate things, in this order. The first is the one that matters — the
game is playable on a laptop without the second.

---

## 1. Bring the database up to date

The app checks the schema on startup and **falls back to the local backend**
if it is out of date, with the reason on screen. Until this is done you will
see:

> Running on the local backend. Answers would not be anonymous: run
> supabase/migrations/20260910150000_anonymity.sql in the SQL editor.

### Option A — the CLI (what you asked for)

`supabase link` needs a personal access token and the database password. Run
these in **your own terminal**, not through an assistant: the CLI puts both in
your OS keychain, and neither should pass through a chat transcript.

```bash
npx supabase login
npx supabase link --project-ref imcgpjxhjdahdwgkyudt
```

`0001` and `0002` were applied by hand, so the remote has no record of them.
Tell the CLI they are already there, or it will re-run them:

```bash
npx supabase migration repair --status applied 20260901120000 20260901120100
npx supabase db push
```

Re-running them is *safe* — `npm run check:sql` proves all three re-apply
cleanly over a database that already holds a played game — but there is no
reason to churn production DDL for nothing.

### Option B — paste it

Open the SQL editor, paste `supabase/migrations/20260910150000_anonymity.sql`
whole, Run. Same result, no tokens.

### Either way, prove it

```bash
npm run verify:live
```

This plays a real two-player round against the live project and asserts the
guarantees the game depends on: an answer is unreadable before the reveal,
unattributed during the vote, a self-vote is refused, a second vote replaces
the first, and the Pass costs zero. **If this does not say `0 failed`, do not
run an event on it.**

---

## 2. Put it on a URL

### Push it

Nothing secret is in the repository — `.env.local` is ignored and the keys
live only in your environment — so this is safe to make public. Create an
empty repo on GitHub, then:

```bash
git remote add origin git@github.com:<you>/campfire.git
git push -u origin main
```

### Deploy it

Import the repo at [vercel.com/new](https://vercel.com/new). Vercel reads
`vercel.json` and needs no configuration, but it **will build a broken app
unless you add the two environment variables first**, because Vite bakes them
into the bundle at build time:

| Name | Where it comes from |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | the same page — the **anon / publishable** key |

Never the `service_role` key. It bypasses every policy, and a Vite variable
ends up in a file any visitor can read.

If you change either variable later, redeploy — editing them does not rebuild.

### Point Supabase at the domain

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://<your-app>.vercel.app`
- **Redirect URLs**: add the same, plus `http://localhost:5173` for local work.

Anonymous sign-in does not use a redirect, so the game will appear to work
without this. Set it anyway — it is what stops the project accepting auth
traffic on behalf of a domain you do not control.

---

## Before you run a real event

- Join from a phone **on cellular, not office wifi**. That is the network path
  that finds the problems.
- Submit, vote, then refresh mid-round. Your seat, score and character should
  all come back.
- Screen-share the Stage into an actual video call and read it from a second
  monitor. Zoom re-encodes hard, and nothing else predicts what survives.
