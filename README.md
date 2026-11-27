# Recallio

Recallio is a mobile-first learning app for active recall and spaced repetition.

## Local development

Requirements: Node.js 24+, pnpm 10+, and MongoDB running as a replica set (MongoDB Atlas works; a standalone local `mongod` does not support atomic study-event writes).

1. Copy `.env.example` to `.env` and set `JWT_SECRET` to a random value of at least 32 characters. Set `MONGODB_URI` to your local or Atlas database.
2. Run `pnpm install`.
3. Run `pnpm dev` to start the web app at `http://localhost:5173` and API at `http://localhost:4000`.

Assessment images are stored outside MongoDB under `MEDIA_STORAGE_DIR` (default `./storage/media`, relative to the API process working directory). Keep that directory on persistent storage when self-hosting; uploaded images are limited to 10 MiB each. For an S3-compatible store such as Cloudflare R2, set `MEDIA_STORAGE_PROVIDER=s3` and provide `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, and `MEDIA_S3_SECRET_ACCESS_KEY`. Each image record remembers its storage provider, so existing local images remain readable after switching new uploads to object storage. Keep provider credentials private and out of source control.

The foundation includes registration, sign-in, session persistence, and the responsive authenticated shell. Phase 2 adds nested deck management, text note creation for Basic, reversed, and cloze note types, generated card records, and a searchable card browser. Phase 3 adds a staged APKG import preview and confirmation flow for the currently supported collection database schema. Phase 4 adds FSRS-7 scheduling, review history with undo, and a focused study flow. Phase 5 adds a live dashboard and statistics derived from persisted cards and review events. Phase 6 supports per-deck offline downloads, local FSRS scheduling, offline undo, and idempotent review sync with deterministic server recomputation. Phase 7 now adds an image-capable multiple-choice question bank, published assessment versions, timed attempts, saved responses, server scoring, and review. Deck snapshots are refreshed manually; offline editing and offline assessments are still pending.

See [the architecture and phased roadmap](docs/architecture.md).
