# Deploying Sprint Buddy

Written to be followed start to finish in one sitting, roughly fifteen minutes
of actual work plus waiting on builds. No prior deployment experience assumed.

Everything the app needs is already in the repository: `Dockerfile` describes
how to run it and `render.yaml` describes what to run it on.

## Why Render

The app keeps its data in SQLite — a single file — and runs on Bun. That rules
out serverless hosts such as Vercel, which have no permanent disk (every deploy
would erase every account and conversation) and run Node rather than Bun.
Render runs the container as-is and attaches a real disk. Railway and Fly.io
would work equally well.

**Region matters.** `render.yaml` pins Frankfurt. Founders are students at a
Finnish university writing private reflections, so the data stays in the EU.
Don't change this without a reason.

## Before you start

- The code is on GitHub.
- You have your Anthropic API key.
- A card for Render — about **$7/month** for the instance and roughly **$0.25**
  for a 1 GB disk. (Anthropic usage is billed separately; see the README.)

## 1. Put the code on the main branch

Deployment tracks `main`. If the work is still on a branch, merge it:

```sh
git checkout main
git merge claude-api-backend
git push
```

## 2. Create the service

1. Sign up at [render.com](https://render.com) and connect your GitHub account.
2. **New → Blueprint**, and select the `ai-for-good` repository.
3. Render reads `render.yaml` and proposes a web service with a 1 GB disk.
   Accept it.
4. It will ask for the values marked `sync: false`:
   - `ANTHROPIC_API_KEY` — paste your key.
   - `PUBLIC_BASE_URL` — leave blank for now; you don't know the URL yet.
5. Click **Apply**. The first build takes a few minutes.

## 3. Tell the app its own address

When the build finishes, Render shows a URL such as
`https://sprint-buddy.onrender.com`.

The app needs to know it, because setup links are built from it. Without this
they point at `localhost` and nobody can use them.

Go to **Environment**, set `PUBLIC_BASE_URL` to that exact URL (no trailing
slash), and save. Render redeploys automatically.

## 4. Create the first organizer

The admin page needs an organizer signed in, and there isn't one yet, so the
first account is created from a terminal on the server.

Open the **Shell** tab on the Render dashboard and run — substituting your own
details and the real URL:

```sh
bun scripts/create-organizer.ts you@aalto.fi "Your Name" https://sprint-buddy.onrender.com
```

It prints a `/setup?token=…` link. Open it in a browser, choose a password, and
you are signed in.

## 5. Add the team and the cohort

Go to **/admin** (or click *Cohort admin*, top right).

- Add the rest of the operating team one at a time, with role **Organizer**.
- Paste the cohort into **Add the whole cohort**, one per line as `Name, email`.
  Everyone added there is a founder.

You get a setup link per person. Send each person their own link over whatever
channel you already use. Each works once and expires after 14 days.

**A setup link is a credential.** Anyone holding it can claim that account, so
send them individually — never to a shared channel.

## 6. Check it works

- Sign in and send the advisor a message. A reply means the API key is good.
- Confirm the URL starts with `https://`. Render provides the certificate.
- Ask a colleague to redeem their link on their own machine.

## Running the sprint

**`SPRINT_WEEK`** tells the advisor where the cohort is in the 13-week
programme, and it shapes what the AI says. Update it in **Environment** each
week — it defaults to `1` and does not advance by itself.

**Removing someone** in `/admin` deletes their account and everything in it,
immediately and permanently. Their session dies at once.

## Backups

The database is one file on the Render disk. Losing it loses everything.

Check what Render's disk snapshots cover on your plan and how far back they
reach. Regardless, take your own copy before anything risky — a schema change,
a big release, the end of a cohort. From the Shell tab:

```sh
cat /app/data/sprint-buddy.db > /tmp/backup.db
```

then download it. Do this at least at the start and end of each cohort.

## Before real founders use it

Founders will write genuinely private things here. Two things worth doing:

1. **Tell them plainly what the operating team can see** — themes, mood trends
   and attention flags, never the conversation itself, unless they choose to
   share one. The product only works if they believe it, and it is only
   believable if it is true. It is enforced in `src/pages/api/persistence.ts`.
2. **Email Aalto's data protection contact.** Student reflections are personal
   data. Hosting in the EU is the substance of it, but a short note describing
   what is collected, where it lives and who can see it is worth having on
   record before the cohort starts, not after.
