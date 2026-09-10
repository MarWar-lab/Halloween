# Setting up Campfire's backend

About fifteen minutes, all in a browser. You do this part because it involves
keys and passwords, which I don't handle.

When you're done, tell me and I'll verify the schema against the live project.

---

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. **New project**. Name it `campfire`.
3. Choose a **database password** — save it in your password manager. You won't
   need it for this app, but you will need it if you ever use the CLI.
4. Pick the region closest to most of your team (**Frankfurt** or **Ireland** for
   a mostly-European team). This is the one setting that's annoying to change
   later, and it's what players feel as lag.
5. Wait for provisioning — a couple of minutes.

## 2. Turn on anonymous sign-in

This is the step that makes "join by link, no account" work. Players get a real
auth token without ever seeing a login screen, which is what the security rules
key on.

1. **Authentication** → **Sign In / Providers**.
2. Find **Anonymous sign-ins** and enable it.
3. Save.

> If you skip this, everything else will look fine until the first person tries
> to join, and then nothing will work. It's the most commonly missed step.

## 3. Run the schema

1. **SQL Editor** → **New query**.
2. Open `supabase/migrations/20260901120000_init.sql` from this repo, copy the whole file,
   paste it in.
3. **Run**.

You should see `Success. No rows returned`. If you get an error, paste it to me
verbatim and I'll fix the migration — don't hand-edit the SQL to get past it, or
the repo and the database will drift apart.

## 4. Copy your two keys

1. **Project Settings** → **API Keys** (older dashboards call this **API**).
2. Copy the **Project URL** — looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon public** key (newer dashboards call it the **publishable**
   key). It's a long string starting `eyJ…` or `sb_publishable_…`.

**Take the anon/publishable key, not the `service_role`/secret one.** The anon
key is designed to ship in a browser and is safe in the frontend; the service
role key bypasses every security rule and must never leave the dashboard.

## 5. Put them in your local env file

In the project root:

```bash
cp .env.example .env.local
```

Then open `.env.local` and paste your two values in. `.env.local` is gitignored,
so it won't be committed.

## 6. Check it works

```bash
npm run dev
```

Open http://localhost:5173. If the header says **Connected**, the URL and key
are good. If it says **Not configured**, the env file isn't being read — restart
the dev server, since Vite only reads env files at startup.

---

## Later: deploying to Vercel

Not needed until you want the team to reach it.

1. Push this repo to GitHub.
2. [vercel.com/new](https://vercel.com/new) → import the repo. Vercel detects
   Vite on its own; leave the build settings alone.
3. Add the same two variables under **Environment Variables**:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy.

Then add your Vercel URL to Supabase under **Authentication** → **URL
Configuration** → **Site URL**.

## Costs

Free tier throughout, comfortably. A 20-person game is a few hundred rows and a
handful of realtime connections for two hours — nowhere near the limits. Supabase
pauses free projects after a week of inactivity, so **open the dashboard once the
day before your event** to make sure it's awake.
