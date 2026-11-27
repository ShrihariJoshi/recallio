# Recallio Architecture and Delivery Phases

## Product direction

Recallio is a mobile-first, offline-capable learning app for active recall, spaced repetition, and exam preparation. V1 starts with text notes/cards and supported Anki `.apkg` imports. The data model leaves room for image questions and timed, NEET-style assessments. The interface should be clean, calm, efficient, and study-first; avoid dashboard clutter and overloaded mobile navigation.

## System architecture

Use a TypeScript monorepo with a React/Vite PWA, Express modular monolith, MongoDB, shared contracts, and a separately runnable import worker within the same deployment unit. Do not introduce microservices at this stage.

```text
apps/
  web/                 React, Vite, Router, TanStack Query, Zustand, Dexie
  api/                 Express REST API and feature modules
  import-worker/       Isolated APKG validation, parsing, and normalization
packages/
  contracts/           Shared Zod schemas and API types
  scheduler/           FSRS adapter and scheduling types
  ui/                  Reusable Recallio components and design tokens
  config/              Shared TypeScript and lint configuration
docs/
```

The API is organized by feature (`auth`, `users`, `decks`, `notes`, `cards`, `reviews`, `scheduler`, `imports`, `assessments`, `statistics`, and `sync`). Each feature owns HTTP routes, validation, services, and repositories. Routes stay thin; domain logic belongs in services. Every user-data query enforces ownership.

## Data model

Use one MongoDB database, `recallio`, with references between collections rather than embedding unbounded data:

- `users`: account, preferences, timezone.
- `decks`: owner, hierarchy, study settings, archive/delete timestamps.
- `noteTypes`: built-in or user-defined fields and templates.
- `notes`: owner, deck, note type, field content, tags, source, external Anki GUID.
- `cards`: owner, note, deck, template ordinal, card type, flags/suspension.
- `cardStates`: current FSRS state, due time, counters, scheduler model/version.
- `reviewLogs`: immutable rating events, event/device IDs, timestamp, state transition.
- `importJobs`: upload fingerprint, status, preview, compatibility report.
- `mediaassets`: owner, MIME type, size, SHA-256 content hash, and private storage key; binary content stays outside MongoDB.
- Assessments: `assessmentquestions`, immutable `assessmentversions`, `assessmentattempts`, and `assessmentresponses`.

Notes represent entered knowledge; cards are generated review items. Keep review history separate from current scheduling state. Initially store text fields; represent field values as typed content blocks so image references can be added later. Store binary media in object storage, never as MongoDB blobs. Timed assessments use a separate domain from flashcard scheduling and freeze the tested question/scoring version for each attempt.

Phase 7 currently supports owner-scoped multiple-choice question authoring (2–6 choices), editing and removal of bank questions, optional JPEG/PNG/WebP question images, editable assessment drafts, immutable published versions, timed attempts, persisted answers, server-side scoring, and post-submit answer/explanation review. A new draft can be forked from a published test; question and test changes affect only subsequently published versions. Each attempt retains its original snapshot. Assessment scores do not write FSRS review events. Responses are saved as each answer is selected, and submission scores persisted responses.

Local development stores image files under `MEDIA_STORAGE_DIR` (default `./storage/media`) and metadata in MongoDB. `MEDIA_STORAGE_PROVIDER=s3` enables an S3-compatible bucket such as Cloudflare R2 for new uploads; provider and key are recorded per media row so existing local media stays readable. Uploads are limited to 10 MiB and validated from file signatures. Media reads require an authenticated owner session. Ephemeral deployments should use the object-storage provider.

Create owner-scoped indexes for common deck/card queries, due cards, tags, and review history; unique indexes for `(userId, eventId)` and imported external note IDs. Add indexes only as supported query patterns become clear because indexes use the Atlas storage allowance.

## Scheduler and review events

Use the maintained `ts-fsrs` package behind `packages/scheduler`; do not implement FSRS math. The study engine starts with `ts-fsrs@6.0.1`, FSRS-7, 90% desired retention, and the library's default learning steps. Persist the package/model version, retention, and complete scheduler state so future scheduler upgrades can be migrated deliberately. Rating events are immutable, idempotent by `(userId, eventId)`, and include before/after state; undo appends a compensating event and restores the prior schedule.

Review writes update `cardStates` and append to `reviewLogs` in one MongoDB transaction. Use MongoDB Atlas or a local replica-set deployment; a standalone local `mongod` does not support this atomic write path.

The statistics endpoint derives due/new counts from active cards and `cardStates`, and daily activity/rating totals from `reviewLogs`. It groups by the learner's IANA time zone and excludes review events that have a later undo event. Rating distributions describe self-reported recall and are not correctness or exam-score metrics.

After answer reveal, the learner chooses Again, Hard, Good, or Easy. Persist an immutable event locally first, calculate the immediate next state, then sync the event. The server deduplicates by event ID and recomputes canonical state if offline events arrive out of order or conflict. A test score never changes flashcard scheduling.

FSRS references: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), [Anki FSRS guide](https://docs.ankiweb.net/deck-options.html#fsrs).

## APKG import and security

Import is an isolated, staged pipeline: validate extension/signature/size; quarantine upload; enforce archive path, entry-count, decompressed-size, and time limits; detect package/database format; parse read-only SQLite; normalize decks, note types, notes, cards, tags, media references, and scheduling data where supported; produce a preview and compatibility report; commit only after user confirmation.

Support a documented subset (Basic, reversed, cloze, common field/template rules, sanitized basic HTML, media references). Preserve unsupported template source for reporting, but never execute imported JavaScript. Make repeated imports idempotent using package fingerprints and external Anki identifiers. Treat collection packages as additive imports; never replace a Recallio collection. Use real fixtures across package formats before declaring compatibility.

Anki package references: [export/package behavior](https://docs.ankiweb.net/exporting.html), [card generation](https://docs.ankiweb.net/templates/generation.html).

## Offline data and synchronization

Dexie stores downloaded `decks`, `notes`, `cards`, `cardStates`, immutable `reviewEvents`, `syncQueue`, and `syncMetadata`; add assessment stores when offline tests are implemented. The service worker caches the app shell. IndexedDB is a local working cache, not the server source of truth.

Every review gets a stable event ID and device ID. Queue events atomically with local state updates, retry safely, and mark synced only after acknowledgement. For competing offline reviews, preserve both events, deterministically order them, and recompute state rather than applying last-write-wins. Surface Online, Offline, Syncing, Synced, and Failed states; do not depend on iOS Background Sync.

Phase 6 implementation: the app shell/assets are cached, learners can download or refresh a complete active-card snapshot for a deck, and current FSRS state is stored in a user-scoped Dexie database. Local ratings and undo update that state immediately. Queued reviews sync in batches; the server deduplicates event IDs and deterministically replays each card's review history before saving canonical state. Undo actions sync after their target review. Server-rejected actions remain in the queue with a visible failed state. Deck snapshots are refreshed manually; background sync and offline editing are not implemented yet.

## Frontend design direction

Use warm neutral surfaces, charcoal text, one muted accent, generous spacing, restrained borders/shadows, readable typography, and light/dark themes. Use Tailwind design tokens and accessible shadcn/ui primitives selectively; use Lucide icons consistently. Motion is brief, purposeful, and reduced-motion aware.

- Mobile navigation: Home, Decks, Stats; Add is a separate action. Profile/settings live in the profile menu.
- Desktop navigation: compact sidebar for Home, Decks, Browse, and Stats; clear Add and Import actions.
- Study mode hides global navigation and prioritizes question, reveal, and large rating actions with next intervals.
- Home shows real due counts, progress, recent decks, and a prominent study action.
- Offline/sync status stays visible but unobtrusive. Editors start text-first and support structured media later.

## API and security baseline

Use versioned REST endpoints under `/api/v1`, shared Zod contracts, a consistent `{ success, data, message }` envelope, cursor pagination, centralized errors, and ownership checks. Core routes cover auth, decks, notes, cards, due reviews/history, statistics, imports, and sync; assessment routes are added with that feature.

Use Argon2id password hashing, secure HTTP-only cookies, CSRF protection, rate limiting, request validation, Mongo query sanitization, safe HTML rendering, and environment-based secrets. Keep uploads quarantined and apply strict limits.

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

For an early targeted launch, use one MongoDB Atlas free cluster for structured data and introduce object storage only when image/audio support is built. Atlas Free currently has a 512 MB hard storage limit including indexes, so monitor growth and keep backups outside the cluster. R2 currently provides a free standard-storage allowance suitable for an early media prototype. Verify provider limits at deployment time; free tiers can change and do not guarantee production availability.

Primary risks are APKG format variation, unsafe imported content, offline review conflicts, and browser storage eviction. Mitigations are versioned import adapters and compatibility reports, sanitization/isolation, immutable review events with recomputation, and visible sync state with server acknowledgement.
