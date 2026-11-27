# Recallio Architecture and Delivery Phases

## Product direction

Recallio is a mobile-first, offline-capable learning app for active recall, spaced repetition, and exam preparation. V1 starts with text notes/cards and supported Anki `.apkg` imports. The data model leaves room for image questions and timed, NEET-style assessments. The interface should be clean, calm, efficient, and study-first; avoid dashboard clutter and overloaded mobile navigation.

## System architecture

The current implementation is a TypeScript monorepo with a React/Vite PWA, an Express modular monolith, MongoDB, shared Zod contracts, an FSRS package, and Dexie for browser storage. APKG parsing runs synchronously inside the API process; there is no import worker. Keep the modular monolith until measured load justifies a separate worker.

```text
apps/
  web/                 React, Vite, Router, TanStack Query, Dexie
  api/                 Express REST API and feature modules
packages/
  contracts/           Shared Zod schemas and API types
  scheduler/           FSRS adapter and scheduling types
docs/
```

The API is organized by feature (`auth`, `decks`, `notes`, `cards`, `reviews`, `imports`, `assessments`, `statistics`, `media`, and `sync`). Routes and services use Mongoose models directly; there is not yet a separate repository layer. User-owned reads and writes are scoped by `userId`.

## Data model

Use one MongoDB database, `recallio`, with references between collections rather than embedding unbounded data:

- `users`: account, preferences, timezone.
- `decks`: owner, hierarchy, study settings, archive/delete timestamps.
- `noteTypes`: built-in or user-defined fields and templates.
- `notes`: owner, deck, note type, field content, tags, source, external Anki GUID.
- `cards`: owner, note, deck, template ordinal, card type, flags/suspension.
- `cardStates`: current FSRS state, due time, counters, scheduler model/version.
- `reviewEvents`: immutable rating events, event/device IDs, timestamp, state transition.
- `importJobs` and `importStages`: upload fingerprint, status, preview, compatibility report, and staged deck/note/card payloads.
- `mediaAssets`: owner, MIME type, size, SHA-256 content hash, and private storage key; binary content stays outside MongoDB.
- Assessments: `assessmentquestions`, immutable `assessmentversions`, `assessmentattempts`, and `assessmentresponses`.

Notes represent entered knowledge; cards are generated review items. Note fields are sanitized HTML strings, while assessment images are private media assets stored in the configured filesystem or S3-compatible provider. Review history is separate from current scheduling state. Timed assessments freeze the tested question/scoring version for each attempt.

Phase 7 currently supports owner-scoped multiple-choice question authoring (2–6 choices), editing and removal of bank questions, optional JPEG/PNG/WebP question images, editable assessment drafts, immutable published versions, timed attempts, persisted answers, server-side scoring, and post-submit answer/explanation review. A new draft can be forked from a published test; question and test changes affect only subsequently published versions. Each attempt retains its original snapshot. Assessment scores do not write FSRS review events. Responses are saved as each answer is selected, and submission scores persisted responses.

Local development stores image files under `MEDIA_STORAGE_DIR` (default `./storage/media`) and metadata in MongoDB. `MEDIA_STORAGE_PROVIDER=s3` enables an S3-compatible bucket such as Cloudflare R2 for new uploads; provider and key are recorded per media row so existing local media stays readable. Uploads are limited to 10 MiB and validated from file signatures. Media reads require an authenticated owner session. Ephemeral deployments should use the object-storage provider.

Create owner-scoped indexes for common deck/card queries, due cards, tags, and review history; unique indexes for `(userId, eventId)` and imported external note IDs. Add indexes only as supported query patterns become clear because indexes use the Atlas storage allowance.

## Scheduler and review events

Use the maintained `ts-fsrs` package behind `packages/scheduler`; do not implement FSRS math. The study engine starts with `ts-fsrs@6.0.1`, FSRS-7, 90% desired retention, and the library's default learning steps. Persist the package/model version, retention, and complete scheduler state so future scheduler upgrades can be migrated deliberately. Rating events are immutable, idempotent by `(userId, eventId)`, and include before/after state; undo appends a compensating event and restores the prior schedule.

Review writes update `cardStates` and append to `reviewEvents` in one MongoDB transaction. Manual note create/edit/delete now also commit note, card, and card-state changes together. Use MongoDB Atlas or a local replica-set deployment; a standalone local `mongod` does not support this atomic write path.

The statistics endpoint derives due/new counts from active cards and `cardStates`, and daily activity/rating totals from `reviewLogs`. It groups by the learner's IANA time zone and excludes review events that have a later undo event. Rating distributions describe self-reported recall and are not correctness or exam-score metrics.

## Account access

Authentication uses an HTTP-only Recallio session cookie with email/password sign-in. Password recovery and external identity providers are not currently enabled. The profile page allows changing the display name and sign-in email.

After answer reveal, the learner chooses Again, Hard, Good, or Easy. Persist an immutable event locally first, calculate the immediate next state, then sync the event. The server deduplicates by event ID and recomputes canonical state if offline events arrive out of order or conflict. A test score never changes flashcard scheduling.

FSRS references: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), [Anki FSRS guide](https://docs.ankiweb.net/deck-options.html#fsrs).

## APKG import and security

Import is a staged pipeline in the API process: validate extension and ZIP signature; write the upload to a temporary file; enforce entry-count, path, and expanded ZIP limits; parse SQLite as data with fixed queries; normalize decks, notes, cards, tags, and referenced media; produce a preview; and persist after user confirmation. Zstandard frames are checked for declared output/window sizes and decompressed within limits. The parser currently has no worker isolation or explicit CPU timeout. Import confirmation uses repeatable upserts but is not an all-or-nothing MongoDB transaction; a failed confirmation can leave partial additive writes until a retry completes.

Support a documented subset (Basic, reversed, cloze, common field-name rules, sanitized HTML, and referenced images). SVG is sanitized; audio/video playback and Anki scheduling history migration are unsupported. Package fingerprints flag duplicates, and external Anki GUIDs update matching notes. Importing is additive and never replaces a Recallio collection. Validate modern compressed `.anki21b` packages with real fixtures before claiming compatibility; the supplied 2025 NEET package was parsed read-only and contained two unsupported note types.

Anki package references: [export/package behavior](https://docs.ankiweb.net/exporting.html), [card generation](https://docs.ankiweb.net/templates/generation.html).

## Offline data and synchronization

Dexie stores downloaded `decks`, `notes`, `cards`, `cardStates`, immutable `reviewEvents`, `syncQueue`, `syncMetadata`, assessment packages/attempts, and cached images. The service worker caches the app shell and static assets, not API responses. IndexedDB is a local working cache, not the server source of truth; cached study data is not encrypted at rest.

Every review gets a stable event ID and device ID. Queue events atomically with local state updates, retry safely, and mark synced only after acknowledgement. For competing offline reviews, preserve both events, deterministically order them, and recompute state rather than applying last-write-wins. Surface Online, Offline, Syncing, Synced, and Failed states; do not depend on iOS Background Sync.

Offline study supports downloading/refreshing a deck snapshot, local ratings and undo, queued review sync, and retry visibility. Published tests can be downloaded with images, attempted offline, and synced later; offline test integrity is marked unverified. Deck snapshots are refreshed manually; background sync and offline editing of notes/decks are not implemented.

## Frontend design direction

Use warm neutral surfaces, charcoal text, one muted accent, generous spacing, restrained borders/shadows, readable typography, and light/dark themes. Use Tailwind design tokens and accessible shadcn/ui primitives selectively; use Lucide icons consistently. Motion is brief, purposeful, and reduced-motion aware.

- Mobile navigation: Home, Decks, Stats; Add is a separate action. Profile/settings live in the profile menu.
- Desktop navigation: compact sidebar for Home, Decks, Browse, and Stats; clear Add and Import actions.
- Study mode hides global navigation and prioritizes question, reveal, and large rating actions with next intervals.
- Home shows real due counts, progress, recent decks, and a prominent study action.
- Offline/sync status stays visible but unobtrusive. Editors start text-first and support structured media later.

## API and security baseline

Use versioned REST endpoints under `/api/v1`, shared Zod contracts, a consistent `{ success, data, message }` envelope, bounded list results, centralized errors, and ownership checks. Routes cover auth, decks, notes, cards, due reviews/history, statistics, imports, media, assessments, and sync. List endpoints currently use fixed limits rather than cursor pagination.

Authentication currently uses bcryptjs (cost 12), seven-day HTTP-only JWT cookies, issuer/algorithm checks, SameSite Strict cookies, CSRF double-submit protection, and rate limits on authentication and APKG imports. Inputs use Zod; note/question content is sanitized before storage/rendering. Secrets are loaded from ignored `.env`; production must set secure cookies, a precise web origin, and strong secrets. Other authenticated write endpoints and media upload do not yet have explicit rate limits.

## Delivery phases

0. **Research and architecture** — document product boundaries, data model, API conventions, import strategy, scheduler, offline sync, design system, risks, and compatibility assumptions. **This document completes the initial architecture artifact.**
1. **Foundation** — create workspace, TypeScript contracts, API/web shells, configuration, Mongo connection/index setup, auth, protected routes, design tokens, and responsive app shell. Keep it runnable.
2. **Decks and authoring** — nested deck CRUD, note types, text editor, note-to-card generation, browser/search/filter/edit/delete.
3. **APKG import** — secure upload, isolated parsing, preview/report/confirmation, media handling, format fixtures, duplicate behavior.
4. **Study engine** — due selection, FSRS adapter, reveal/rating flow, event history, undo, session state.
5. **Dashboard and statistics** — derive dashboard metrics and learning statistics from actual persisted records.
6. **PWA and offline sync** — app-shell caching, Dexie cache, offline study queue, idempotent push/pull, conflict recomputation.
7. **Assessments and media expansion** — image questions, timed quizzes, versioned tests, attempts, responses, scoring and review flows. The online multiple-choice authoring and attempt flow is implemented; offline assessment attempts, richer question types, and section-based NEET test structures remain future work.
8. **Hardening and release** — security, accessibility, compatibility, responsive behavior, operational backups, and production deployment.

## Free-tier operating assumptions and risks

For an early targeted launch, use MongoDB Atlas for structured data and the configured S3-compatible provider for media. Verify current provider limits, backups, and recovery options at deployment time; free tiers change and do not guarantee production availability. The application repository does not configure automated backups, monitoring, or rollback deployment steps.

Primary risks are APKG format variation, unsafe imported content, offline review conflicts, and browser storage eviction. Mitigations are versioned import adapters and compatibility reports, sanitization/isolation, immutable review events with recomputation, and visible sync state with server acknowledgement.
