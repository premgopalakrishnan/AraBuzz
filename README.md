# AraBuzz

Spelling practice for one class. A CoKindle Labs initiative.

Turns the weekly Spell Buzz sheet into games a child will actually open, notices
which letters they get wrong and why, and writes their parent a plain-English
note each week.

Live at **arabuzz.cokindlelabs.com**.

---

## What this repository is

A plain static web app plus a few serverless functions. There is no build step
and no framework — the files you see are the files that run.

```
index.html          the whole app shell
css/theme.css       the design system
js/                 the app, one file per concern
  garden.js           the drawn garden and every plant in it
  engine.js           which word, which question, which gap — per child
  phonics.js          letter-level diagnosis of a misspelling
  quiz.js             the games
  parent.js           the grown-ups' area
  store.js            local state
api/                serverless functions (the Anthropic key lives here, never in js/)
sw.js               offline support — the app works with no connection
vendor/             self-hosted fonts and pdf.js, so nothing loads from a CDN
```

## Deploying

Pushing to `main` deploys automatically. Vercel settings:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Build Command | *(leave empty)* |
| Output Directory | *(leave empty)* |
| Install Command | *(leave empty)* |

## Environment variables

Set these in Vercel → Settings → Environment Variables. See `.env.example` for
the list. **No key of any kind belongs in this repository.**

After the first deploy, `/api/health` will tell you which ones have been picked
up, without revealing any value.

## Data

Everything lives in Supabase, in a dedicated `arabuzz` schema. Row-level
security is enforced in the database, not the app: a signed-in parent can reach
only their own family's rows, an admin can reach everything, and nothing is
readable without a session.

## A note on the children

Two rules that are not up for negotiation, and are worth stating where the code
lives:

1. **No child is ever compared with another.** No leaderboards, no rankings, no
   class averages. Each child's data stays separate.
2. **Nothing is marked in red.** A wrong answer is shown gently, in a warm
   terracotta, and never counts against the child.
