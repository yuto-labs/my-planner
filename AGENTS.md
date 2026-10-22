# My Planner Repository Guide

## Overview

My Planner is a mobile-first PWA built with Vanilla JavaScript ES Modules. It has no bundler or frontend build transform.

- Production: `https://my-planner-five-alpha.vercel.app`
- Tests: `npm test`
- Static checks: `npm run build`
- Production deploy: `npx vercel --prod --yes`

## Architecture

- `index.html` provides the shared app shell.
- `js/app.js` owns hash routing and global UI.
- `js/modules/` contains screen modules.
- `js/storage.js` owns local data models and persistence entry points.
- `js/sync.js` owns Supabase synchronization and conflict handling.
- `api/ai/` contains Vercel Functions for Gemini requests and durable AI jobs.
- `supabase/` contains the base schema and ordered migrations.

The browser keeps a local-first copy. Synchronization must merge remote changes without replacing populated local data with an incomplete or empty pull.

## Safety Rules

- Never expose `GEMINI_API_KEY` or a Supabase Service Role Key to browser code.
- AI endpoints that can reach Gemini must call `assertAiAllowed` (`api/ai/_access.js`) after authentication. Allowed accounts come only from the `AI_ALLOWED_USERS` Vercel environment variable (emails or user ids, comma-separated); never hard-code them. Sign-up stays open because shared-calendar invitations need it.
- Do not remove or overwrite user records as part of a migration. Preserve trash and tombstone behavior.
- Keep `storage.js` independent from `sync.js`; synchronization registers through the existing hook.
- Keep API and Supabase responses out of Service Worker caches.
- Treat generated AI text as untrusted. Normalize and validate structured output before saving it.
- `mp_knowledge`, `mp_trash`, `mp_task_archive`, and `mp_events` live in IndexedDB through `js/local-store.js`. Read and write them only through `storage.js` or `localStore`; never through `localStorage` directly.
- Permanently deleting trash must keep the deletion record (`purgeTrashItem`). Sync relies on trash rows to confirm deletions on other devices.
- Sync backups are full copies of a collection. Write them through `archiveSyncBackup` (IndexedDB, newest three per collection), never into `localStorage`.
- The Claude connector (`api/mcp.js`, see `docs/claude-connector.md`) is read-only. It reads with the service role key through `serviceSelect` in `api/_supabase.js`, so every query must filter `user_id=eq.<token subject>`. Never add write tools without the owner's request, and never return password-like database columns (`looksSecret`).

## Sync

- Periodic sync reads a light change signature (`readRemoteSignature`) and pulls only the tables whose signature line changed (`planRemotePull`); every five minutes it pulls everything.
- A new synced table must be added to both `PULLERS` and `readRemoteSignature` in `js/sync.js`, or other devices will only see its changes on the five-minute full pull.

## Code Style

- The owner is learning to code by reading this repository. Explain new or changed code with Japanese comments that say what the code is for and what it prevents, not a line-by-line translation.
- Keep code short: reuse existing helpers instead of adding parallel implementations.
- Every named function or arrow function needs a `/** */` comment; `npm run build` fails otherwise.
- CSS: change the existing rule instead of appending a later rule with the same selector that overrides it. `npm run build` fails on such dead declarations (`npm run css:check`); `npm run css:fix` removes them safely.
- Modals: build the modal element and show it with `window.AppNav.mountModal` (or `openModal`); do not manipulate `#modal-overlay` directly.

## Tests

- `npm run e2e` runs Playwright smoke tests (`tests/e2e`) in a phone-sized Chromium with touch: every main screen opens, long-press reordering, memo markers, and draft restore. Add a case there when a UI interaction breaks.

- CI runs on both Ubuntu and Windows. Windows checks files out with CRLF line endings, so a test that matches source text must accept `\r\n` (use `\s` or `\r?\n`, never a bare `\n`).
- Avoid assertions that depend on timing or on two `Date.now()` calls being different.

## UI Compatibility

- Preserve the established smartphone layout unless a task explicitly changes it.
- Calendar month view uses two-step day interaction: first tap selects a date, second tap opens its day sheet.
- Do not add global horizontal-swipe navigation. Calendar gestures must stay inside the calendar surface.
- Keep touch targets usable without allowing invisible overlays to intercept the page.

## Service Worker

When app-shell JavaScript, CSS, HTML, or cached assets change:

1. Increment `CACHE_VER` in `sw.js`.
2. Keep asset query versions in `index.html` and `sw.js` consistent when those query versions change.
3. Add new offline-required modules to `APP_ASSETS`.

API routes and Supabase requests must remain network-only.

## Change Workflow

1. Read the surrounding module and its tests before editing.
2. Keep changes scoped and preserve existing records and schema compatibility.
3. Add or update regression tests for behavior changes.
4. Run `npm run build` and `npm test`.
5. Review `git diff --check` and the final diff before committing.

Use `apply_patch` for manual edits. Do not revert unrelated working-tree changes.
