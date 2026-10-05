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
- Do not remove or overwrite user records as part of a migration. Preserve trash and tombstone behavior.
- Keep `storage.js` independent from `sync.js`; synchronization registers through the existing hook.
- Keep API and Supabase responses out of Service Worker caches.
- Treat generated AI text as untrusted. Normalize and validate structured output before saving it.

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
