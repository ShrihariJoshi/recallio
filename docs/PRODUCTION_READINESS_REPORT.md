# Recallio Production Readiness Report

**Audit date:** 2026-11-27  
**Assessment:** **NO-GO for a public production launch**  
**Scope:** Repository review, baseline and regression checks, targeted security/data-integrity fixes, read-only parsing of the supplied APKG, and a read-only smoke check of the running Home screen. No production deployment or database writes were performed.

## Executive summary

Recallio is a TypeScript monorepo containing a React/Vite PWA, Express 5 API, MongoDB/Mongoose persistence, shared Zod contracts, an FSRS scheduler package, Dexie offline storage, service-worker shell caching, and a staged APKG import pipeline. Timed multiple-choice assessments and offline attempts are implemented in addition to flashcards.

The baseline scheduler and API pipeline tests passed before remediation. The audit found three high-severity code risks in dependency validation and untrusted APKG processing. All three were fixed and regression tests were added. Manual note creation, editing, and deletion now use MongoDB transactions to keep notes, generated cards, and scheduler state consistent.

The final production dependency audit reports no known vulnerabilities. The full automated test set now passes (14 tests), TypeScript checks pass, the production build succeeds, and the supplied APKG parses locally without a database write.

The NO-GO status is due to release controls that still need a staging environment and operational confirmation: import confirmation is not atomic and is not concurrency-locked; there is no CI/E2E or isolated Mongo integration suite; modern `.anki21b` compressed Anki packages have not been validated with a real fixture; backups, restore drills, monitoring, and rollback are not configured in this repository; and small-screen/accessibility coverage is incomplete. These items need to be closed or explicitly accepted before public signup.

## Architecture assessment

### Current implementation

- **Frontend:** React 19, TypeScript, Vite 6, React Router, TanStack Query, DOMPurify, and Lucide. There is no Zustand store. UI state is primarily component/query state.
- **Backend:** Express 5 modular monolith. Feature routes use Mongoose models directly; a separate repository layer is not present.
- **Database:** MongoDB with Mongoose schemas for users, decks, notes, cards, card states, review events, imports/stages, assessment questions/versions/attempts/responses, and media metadata.
- **Scheduling:** `ts-fsrs` behind `packages/scheduler`; review events are replayed and deduplicated. Review writes use MongoDB transactions.
- **Offline:** Dexie stores per-user deck/card snapshots, scheduler states, queued review events, assessment packages/attempts, and images. The service worker caches the app shell/static assets, not API responses. Browser IndexedDB data is not encrypted at rest.
- **Media:** Filesystem or S3-compatible storage, with metadata and ownership in MongoDB. Reads are authenticated.
- **APKG:** Uploads are written to a temporary file and parsed in the API process. There is no isolated import worker or explicit parser CPU timeout.
- **Runtime requirements:** Node `>=24`, pnpm `10.11.0` as declared by the repository, and MongoDB configured through environment variables.

The architecture document was updated to describe the code that exists instead of proposed but absent packages and capabilities: [architecture.md](./architecture.md).

## Findings and remediation

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-01 | High | The active pnpm dependency graph contained Zod 3.25.76, which the registry audit flagged for memory exhaustion when validating constrained collections. | **Fixed:** API, web, and contracts now use Zod 4.6.7. Full `pnpm audit` is clean. |
| IMP-01 | High | Zstandard decompression allocated output/window memory before the parser applied its size checks. | **Fixed:** frame declarations and window sizes are validated before decoding; output is streamed under explicit limits. Regression tests cover declared-size caps, oversized windows, multi-frame output caps, malformed and truncated input. |
| IMP-02 | High | Mapping each note to a card used a full card-array scan. At the configured 20,000-note and 50,000-card limits, that could require close to one billion comparisons. | **Fixed:** one-pass note-to-card indexing is linear in cards plus notes. A 50,000-card regression test verifies first-card behavior and index size. |
| IMP-04 | Medium | ZIP entry paths were normalized and validated, but duplicate names (including backslash/slash aliases) were silently overwritten in the parser's entry map. | **Fixed:** normalized duplicate names are now rejected. Tests cover path traversal, absolute/drive paths, NUL bytes, and duplicate aliases. |
| DATA-01 | Medium | Manual note operations wrote the note, generated cards, and card state separately, allowing partial records if a later write failed. | **Fixed in code:** create/edit/delete now run in MongoDB transactions. No live database integration test was run; verify in an isolated replica-set staging database. |
| IMP-03 | Medium | Import confirmation writes decks, notes, cards, states, job status, and stage cleanup as separate operations. It is not atomic, and concurrent confirmations can race. Abandoned preview stages/assets have no automatic expiry cleanup. | **Open:** GUID/card upserts make retries mostly repeatable, but they do not prevent concurrent confirmation or provide rollback. Add an atomic confirmation claim/retry policy and scheduled cleanup before public use. |
| AUTH-01 | Medium | Duplicate registration returns `EMAIL_IN_USE`, revealing whether an email is registered. | **Open / accepted product tradeoff required:** use a generic response if signup enumeration is not acceptable for a public service. Login already returns a generic invalid-credentials message. |
| AUTH-02 | Medium | Rate limits cover authentication and APKG imports. Authenticated media upload and other write endpoints do not have explicit limits. | **Open:** add user/IP-aware limits and a deployment-compatible shared limiter before broad public signup. |
| TEST-01 | Medium | Offline attempt sync trusts the client-supplied start time and answers. The server stores `offline_unverified`, but the attempt list/result response does not expose that integrity marker. | **Open:** keep offline test scores informational; expose the unverified status in result/history UI. Do not use offline submissions for proctored or high-stakes exam results. |
| OFF-01 | Medium | Offline notes, review data, assessment packages, and attempts persist in unencrypted IndexedDB; an offline user profile snapshot persists in localStorage. | **Documented limitation:** this follows the offline model but does not protect data from another person using the same browser profile/device. Provide shared-device guidance or implement local data clearing/encryption policy. |
| OPS-01 | High release gate | Repository contains no CI workflow, automated backup/restore procedure, monitoring/error tracking configuration, or rollback instructions. The health endpoint returns `ok` without checking database readiness after startup. | **Open:** establish and test these controls in the actual hosting environment. |
| QA-01 | High release gate | Automated tests cover scheduler behavior and review persistence, plus the new parser/auth checks. There are no browser E2E tests, APKG import-persistence integration tests, or isolated MongoDB CRUD/transaction tests. | **Open:** create a staging/test database and automate sign-in, create/edit/study, import/rollback/retry, media, assessment, offline, and account-boundary flows. |
| PERF-01 | Low | Vite emits a main bundle warning: 899.77 kB minified / 233.59 kB gzip; main CSS is 71.74 kB / 15.26 kB gzip. | **Open optimization:** lazy-load routes and measure mobile startup before further bundle tuning. |
| DOC-01 | Low | Architecture documentation described an import worker, Zustand, Argon2id, cursor pagination, and assessment/offline features inaccurately. | **Fixed:** documentation updated to reflect current implementation and limitations. |

## APKG security and correctness assessment

### Existing protections observed

- Upload is authenticated, limited to 35 MiB and one `.apkg` file, and rate limited to 10 requests per hour per API-observed IP.
- The parser checks the ZIP signature, caps archive entries at 10,000, caps ZIP-expanded size at 150 MiB, rejects absolute/traversal/colon/NUL paths, and does not extract arbitrary paths to disk.
- SQLite is loaded in memory and accessed through fixed read-only `SELECT` statements. Imported SQL is treated as data.
- Parser caps the collection database at 90 MiB, notes at 20,000, cards at 50,000, and total media at 80 MiB.
- Imported HTML is sanitized server-side; SVG media is sanitized; image types are identified from bytes; stored media uses random storage keys and owner-scoped access.
- The uploaded temporary APKG file is removed in the route's `finally` handler.

### Remaining APKG limits

- Parsing still runs synchronously in the API process and can block the event loop; there is no worker isolation, explicit per-import timeout, or global concurrent-import cap.
- Confirm is not transactional or protected by an atomic claim. A partial failure can leave additive records and a preview job; a retry generally reuses GUID/card upserts, but duplicate confirmations can race.
- Abandoned preview rows and their media/stages can persist indefinitely unless the user discards the import.
- Anki review history is reported but not migrated. Audio/video is not playable. Some note types/templates are unsupported.
- The supplied 31,594,620-byte NEET package was parsed read-only: 1,927 notes, 2,080 cards, 3,393 supported images (30,718,393 bytes), and two unsupported note types. No UUID-shaped question/answer fields were detected in the parser output. This was not a database import, and it does not establish compatibility with all Anki versions. A real compressed `.anki21b` fixture is still required to exercise the new Zstandard path end-to-end.

## Authentication, authorization, and privacy

- Passwords use bcryptjs with cost 12. Sessions are seven-day JWTs in HTTP-only cookies. Verification now requires the `recallio` issuer and HS256 algorithm.
- CSRF uses a SameSite Strict double-submit token; Helmet is enabled; CORS permits the configured web origin with credentials.
- Protected feature routes scope account data by authenticated `userId`. Media reads check both media ID and owner.
- Authenticated routes use HTTP-only session cookies rather than JavaScript-readable auth tokens. The local offline profile value is not an auth credential, but it is editable browser storage and must never be trusted by the API.
- Password recovery, email verification, OAuth, and account deletion are currently absent by product choice. Public launch should have a documented support/recovery path and make this limitation clear to users.
- `.env` is ignored by Git and was not displayed or copied into this report. A tracked-file scan found no matches for common cloud-key, private-key, or Mongo credential patterns; Git history was not scanned and a dedicated secret scanner is not installed.

## Dependency and static-analysis results

- `pnpm audit`: **no known vulnerabilities found** after upgrading all direct workspace Zod dependencies to 4.6.7.
- Before the fix, `pnpm audit --prod` reported the Zod advisory. `npm audit --omit=dev` returned zero, but `package-lock.json` contains only the root npm dependency graph and does not represent the pnpm workspace packages; treat pnpm as the authoritative audit.
- `pnpm outdated --recursive` reports newer patch and major releases (including PostCSS, Mongoose, Vite, bcryptjs, and TypeScript). No blanket upgrades were applied; major upgrades need separate compatibility review.
- No ESLint/lint script, Semgrep, Gitleaks, CodeQL, or Playwright suite is configured/available in the repository.
- `git diff --check`: passed.

## Test and validation results

### Baseline before remediation

- Scheduler tests: 3 passed.
- API FSRS pipeline tests: 3 passed.
- TypeScript typecheck: passed.
- Production build: passed; main bundle was approximately 871 kB minified / 222 kB gzip.

### After remediation

- Scheduler tests: **3 passed** (including deterministic FSRS simulation: 88.4% modeled recall over 1,635 reviews, compared with the test's daily-review baseline of 73,000 reviews).
- API tests: **11 passed** (auth issuer/algorithm behavior, parser note indexing, Zstandard safety, and FSRS persistence/replay/statistics).
- Total automated tests: **17 passed, 0 failed** (14 API tests and 3 scheduler tests).
- `pnpm typecheck`: passed.
- `pnpm build`: passed. Vite warns that the main bundle exceeds 500 kB and emits harmless annotation-position warnings from Zod 4; no build errors.
- `pnpm audit`: no known vulnerabilities found.
- Supplied APKG parser smoke check: passed read-only with counts above.
- Chrome smoke check: Home loaded and showed account-backed dashboard/navigation. No create/edit/delete/import/review action was run against the connected account. Responsive, accessibility, and browser error-console checks were not exhaustive.

No MongoDB integration tests were run, because the repository's `.env` target was not inspected and no separate disposable staging database was established. This avoided risking any production or user data.

## Performance and scalability

- The quadratic note/card lookup is fixed and covered at 50,000 cards.
- Parser byte, entry, note, card, and media limits exist. Zstandard output and window memory are now bounded.
- The main frontend bundle remains large; route-level code splitting is recommended.
- There is no load-test baseline. Do not run load tests against production; use an isolated environment and representative synthetic data.
- Current list APIs use bounded fixed limits rather than cursor pagination. For the current targeted user base this is workable, but large collections will need server-side pagination/index review.

## Deployment readiness and launch gates

Before first public release:

1. Deploy to a staging environment backed by a separate MongoDB database and verify the replica-set transaction requirement.
2. Configure and test automated backups plus a restore drill; document database rollback and deployment rollback procedures.
3. Add CI checks for lockfile install, `pnpm audit`, typecheck, tests, and production build; add secret scanning.
4. Add isolated API/Mongo integration tests and Playwright E2E coverage for signup/login, profile, deck/note CRUD, study/review/undo, APKG preview/confirm/failure/retry, image storage/read, assessment timing/submission/offline sync, and cross-user denial.
5. Add `.anki21b` and malformed/bomb fixtures. Confirm memory and latency limits under one and multiple concurrent imports.
6. Make import confirmation concurrency-safe and define cleanup/expiry for abandoned preview stages and uploaded media.
7. Configure health/readiness checks, structured error monitoring, API latency/import failure monitoring, TLS, narrow CORS origin, production JWT secret, secure cookies, and upload/write limits.
8. Verify responsive layouts on small iPhone and iPad sizes, keyboard and screen-reader paths, reduced motion, and WCAG 2.2 AA contrast/focus requirements.
9. Decide whether to keep or replace the incomplete `package-lock.json`; this repository declares pnpm as its package manager and should have one authoritative workspace lockfile.
10. Confirm provider free-tier/storage limits, data retention, email/account recovery support policy, and public signup expectations.

## Final assessment

**NO-GO for a public launch today.** The high-severity code findings discovered in this audit have been fixed and the current automated checks pass. A public launch still needs isolated end-to-end and MongoDB validation, import confirmation concurrency/cleanup work, operational backup/monitoring/rollback readiness, real modern APKG compatibility coverage, and a responsive/accessibility pass. Reassess the status after those gates pass in staging; no production deployment was performed as part of this audit.
