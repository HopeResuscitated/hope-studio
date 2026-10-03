# Hope Studio

Hope Resuscitated's agent platform: **Grant Studio**, **Outreach Studio** and **Social Studio** on one shared core. All three draw on one knowledge base, pass through one Reviewer and wait in one approvals inbox. **Nothing is submitted, sent or posted without a person approving it**, and that rule is enforced in the data layer, not just the screens.

| Agent | Does on its own | Waits for approval before |
| --- | --- | --- |
| Grant Studio | Finds grants, checks eligibility, drafts answers with citations, scores against the funder rubric | Exporting a draft or marking it ready to submit |
| Outreach Studio | Finds prospects, matches Partner Guide offerings, drafts 3-step sequences, tracks the 5 partnership steps | Sending any email |
| Social Studio | Tags uploads, fills the Mon/Wed/Fri calendar, writes IG + FB captions and alt text, copies months | Anything going live on Instagram or Facebook |

No framework: plain HTML, CSS and JavaScript in the browser, and a Node server with no dependencies. The one optional package is the official Anthropic SDK, which the agents use when you add an API key.

## Run it

```bash
cd hope-studio
npm install        # optional: adds the Anthropic SDK for Claude drafting
npm start          # http://localhost:8787
```

Needs Node 20 or newer. On first start the server creates `data/hope-studio.json` and prints a one-time password for `leila` (admin and approver) and `cierra` (approver). Change one with `npm run password -- leila`.

Run `npm run check` to test the guarantees: approval gate, roles, CAN-SPAM, minors, consent, character limits, citations, Copy month.

**Demo without the server:** open `web/` from any static host. With no server to talk to, the same core runs in the browser with sample data kept in that browser. Nothing is emailed or posted.

## Put it online (stable, and on your phone)

Hope Studio needs an always-on Node server: it keeps your data and saved keys on disk, and it runs the Monday agent run and the 5-minute publish queue itself. Vercel only serves the `web/` folder, so a Vercel site runs as the in-browser demo.

**Render (recommended).**
1. In Render, choose **New › Blueprint** and pick this repo. `render.yaml` sets up everything: an always-on service with https, health checks, auto-deploy on every push, and a 1 GB permanent disk at `/var/data`. It needs the Starter plan, about $7 a month.
2. Render asks for `LEILA_PASSWORD` and `CIERRA_PASSWORD`. Use long ones.
3. Open the `…onrender.com` address it gives you. The sign-in redirect addresses pick it up automatically.
4. Optional: add a custom domain such as `studio.hope-resuscitated.org` in Render. Then set `PUBLIC_BASE_URL` to that address and use it in the Google and Meta redirect URIs.

**Railway.** New project › Deploy from GitHub. Add a volume mounted at `/app/data`, and set `COOKIE_SECURE=1` and the two passwords. The public address is detected automatically.

**Install it on your phone.** Open the address in Safari on iPhone and choose **Share › Add to Home Screen**, or in Chrome on Android choose **Install app**. Hope Studio then opens full-screen like an app, with a bottom tab bar (Inbox, Grants, Outreach, Social), badges for items waiting on your OK, and shortcuts to the inbox. Sign-ins last 14 days. The app shell opens even without a connection, but approving and sending need one.

## Connect your accounts

Sign in as Leila, open **Settings › Connect your accounts**, and follow the steps on each card. Keys and sign-ins are saved on the server in `data/secrets.json` (readable only by the server, never sent back to the browser, never included in data exports). Values set there win over the same names in `.env`.

| Connection | What you do | What it enables |
| --- | --- | --- |
| **Claude** | Create an API key at console.anthropic.com, set a monthly spend limit, paste the key. It's checked against Anthropic before it's saved. | Drafting and review with Claude Sonnet 5, final grant drafts with Claude Opus 5.5, photo and video tagging with Claude Haiku 4.5 |
| **Gmail and Google Docs** | In Google Cloud Console, enable the Gmail and Google Docs APIs, make an OAuth client (Web application) with the redirect URI shown on the card, paste its ID and secret, then **Connect Gmail** and sign in as Team@hope-resuscitated.org | Approved outreach sends from that account, Gmail drafts, reply and "stop" detection, grant export to Google Docs. **Send me a test email** confirms it. |
| **Facebook and Instagram** | Create a Meta app with Facebook Login, add the redirect URI shown on the card, give Leila and Cierra app roles, link the Instagram professional account to the Page, paste the App ID and secret, then **Connect Facebook** and pick the Page | Approved posts and Reels publish to the Page and its Instagram account |

Things to know:

- **Google consent screen:** use **Internal** for a Google Workspace account. With **External** in testing mode, Google ends the sign-in after 7 days until the app is published.
- **Meta roles:** while the Meta app stays in development mode, people with a role on it can post to Pages they manage. App Review is only needed for anyone beyond that.
- **Facebook posts** upload the file directly, so they work even on a laptop.
- **Instagram** fetches media from a public web address, so Hope Studio must run on a server with an https domain. Set it on the Facebook card or as `PUBLIC_BASE_URL`, and use that domain in both redirect URIs.
- **Other connections:** Grants.gov is on by default. Google Places is `GOOGLE_PLACES_API_KEY` in `.env`.

Other engines and connections, set in `.env`:

- **Ollama / local AI:** free offline inference via Ollama (llama3.1, mistral, deepseek, qwen) or an OpenAI-compatible local server. It's auto-detected at `http://localhost:11434`, or set `OLLAMA_HOST`. `LLM_PROVIDER` picks the engine when several are available. A Claude key saved in Settings is used unless `LLM_PROVIDER` says otherwise.
- **Google Docs** also supports direct Markdown and text downloads.

## What's in it

**14 screens**, one per canvas artboard, under a sidebar that switches between Grants, Outreach and Social. Three shared screens sit alongside them: **Approvals inbox**, **Activity** (runs, costs, alerts, audit log with CSV export) and **Settings**.

- Grants: This week · Scout · Writer + Reviewer · Knowledge base
- Outreach: This week · Prospect Scout · Writer + Reviewer · Execution board · Knowledge base
- Social: This week · Media library · Post composer · Calendar · Copy month

**Shared core** (`web/core/`), used by both the server and the browser demo:

- **Knowledge base.** Documents are chunked at about 800 tokens with 100 tokens of overlap and searched with BM25 full-text. Locked facts (EIN, 5 access points, 40+ doses in week one, $50 + $9 per dose, $3,000 seed, Act 378) are quoted exactly. A fact changes only on the Knowledge screen; the change is audit-logged, and every draft quoting the old value is re-flagged. Questions it can't answer are logged as gaps.
- **Reviewer.** Hard checks in code run first:
  - character limits, and numbers with no source
  - "call 911" as the first response step
  - alt text, the 988 Lifeline on personal topics, banned stigma terms and drug slang
  - youth never described as medical providers
  - CAN-SPAM footer, one clear ask, never contacting students, the opt-out list
  - people in frame without a release

  Then a rubric judge scores the draft: Claude when connected, heuristics otherwise. Most flags come with a one-click fix.
- **Approvals.** `drafted → in_review → needs_you → approved → executed`, with `rejected` and `snoozed`. Store guards refuse to mark anything sent, scheduled, published, exported or ready without an approval by Leila or Cierra. Items with blocking flags can't be approved.
- **Scheduler** (Central time):
  - Mondays 6:00 AM: weekly Grant and Outreach run
  - Daily 5:00 AM: social planner
  - Every 5 minutes: publish queue
  - Daily 8:00 AM: reply and day-7 follow-up check
  - Daily 7:00 AM: deadline watch
  - Nightly: backup
- **Cost guard.** Every run records tokens and cost. A run that reaches its budget stops and alerts the admin.

## Manage it on the go

Hope Studio is built to run from a phone. Install it to the home screen (above), then everything you do most often is one tap or one thumb away.

- **Quick Capture.** A floating **+** button sits above the tab bar on every screen. It opens a bottom sheet with the five things you reach for in the field: **New social post**, **Take a photo**, **Add a contact**, **Find grants**, and **Search everything**. Escape or Cancel closes it.
- **Camera capture.** **Take a photo** opens the phone's camera directly (`capture="environment"`), reads the file, and drops it straight into the Social media library — ready for the agent to tag by content pillar and flag for consent.
- **Pull to refresh.** Drag down from the top of any screen to re-run the view and pull the latest data.
- **Online / offline awareness.** A slim banner appears the moment the connection drops, and the app shell keeps working. When you come back online, a "Back online" toast fires and the current screen refreshes itself. Approving and sending still need a connection — that's deliberate.
- **Thumb-sized targets.** The tab bar and the floating button are sized for one-handed use (44 px tabs, a 56 px action button), and the layout is verified at 390 × 844 (iPhone 12/13/14 class).

## Decisions made so the build could finish

These were the open questions in the build sheet. Each has a default you can change:

- **Stack.** No framework: Node's built-in HTTP server, a JSON data file with atomic writes and nightly backups, and BM25 search instead of Postgres + pgvector. At a few thousand chunks this needs no second vendor. The data model keeps the 18 tables from the build sheet.
- **Candid.** Paste a Candid CSV export into Scout. Instrumentl alert emails are pasted too. Grants.gov is searched automatically.
- **Consent releases.** Confirming permission requires saying where the signed release is kept. It's stored on the media item and audit-logged.
- **CAN-SPAM address.** Set it once in Settings (or on the Outreach screen). No outreach email can be approved until it's there.
- **Who approves.** Leila or Cierra, either one. Settings can require Leila for everything.
- **Grant Studio styling.** Restyled to the Partner Guide purple, like the other two studios.

## Before going live

1. Sign in as Leila and set the mailing address.
2. Verify each locked fact on a Knowledge screen.
3. Upload the missing documents (board bios, historical budgets, cost sheet).
4. In Settings, clear the sample data. It mirrors the design canvases, uses placeholder names like `[High school name]`, and never includes approvals.

Host the server anywhere Node runs with a persistent disk for `data/`, behind HTTPS (`COOKIE_SECURE=1`).

## Files

```
server/   server.js (HTTP, sessions, uploads), scheduler.js, llm.js (Anthropic SDK), integrations.js, selftest.js
web/      index.html, styles.css, app.js (shell and routing), api.js, views/ (screens)
web/core/ store, schema, kb, reviewer, approvals, runs, audit, writer, seed, service, agents/ (grant, outreach, social)
```
