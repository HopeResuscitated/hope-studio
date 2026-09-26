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

## Connect your accounts

Copy `.env.example` to `.env` and fill in what you have. Every connection is optional; each one turns on when its keys are present, and keys never reach the browser.

| Connection | What it does | Settings |
| --- | --- | --- |
| Ollama / Local AI | Free offline local LLM inference via Ollama (llama3.1, mistral, deepseek, qwen) or OpenAI-compatible local servers | Auto-detected at `http://localhost:11434` or set `OLLAMA_HOST` |
| Claude | Drafting and review with Claude Sonnet 5, final grant drafts with Claude Opus 5.5, tagging and triage with Claude Haiku 4.5 (vision tags video frames every 2 seconds) | `ANTHROPIC_API_KEY` |
| Gmail | Sends approved outreach from Team@hope-resuscitated.org, saves drafts, detects replies and "stop" opt-outs | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| Google Docs | Exports approved grant drafts with a character count per answer (also supports direct Markdown & Text downloads) | Same Google OAuth |
| Meta | Publishes approved posts and Reels to the Facebook Page and Instagram | `META_PAGE_ID`, `META_PAGE_TOKEN`, `META_IG_USER_ID`, `PUBLIC_BASE_URL` |
| Grants.gov | Federal grant search for Scout | On by default |
| Google Places | Finds schools, churches, libraries and businesses for Prospect Scout | `GOOGLE_PLACES_API_KEY` |

Without Claude, the agents draft from templates built only from the knowledge base and locked facts. Without Google Docs, approved drafts export as Word files. Meta publishing needs App Review for `pages_manage_posts` and `instagram_content_publish`, so apply early.

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
