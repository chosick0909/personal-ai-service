# RAG SaaS schema

## Layers

1. Global Knowledge
2. Account Data
3. Memory

## Tables

- `accounts`
- `account_profiles`
- `global_knowledge_documents`
- `global_knowledge_chunks`
- `reference_analyses`
- `reference_analysis_chunks`
- `scripts`
- `script_versions`
- `feedback`
- `memories`
- `request_patterns`

## Legacy MVP tables still present

- `documents`
- `chunks`
- `reference_videos`

These are still used by the current MVP flow, but they are now treated as legacy tables.

### Legacy compatibility rules

- `documents.account_id`
- `chunks.account_id`
- `reference_videos.account_id`

All legacy rows are backfilled to the default account with slug `legacy-mvp` so existing APIs can keep working during migration.

## Legacy -> multi-tenant mapping

### `reference_videos` -> `reference_analyses`

- canonical destination: `reference_analyses`
- bridge column: `reference_analyses.legacy_reference_video_id`

Migration intent:
- old video-analysis rows remain readable in `reference_videos`
- new account-aware logic should write to `reference_analyses`
- migrated rows can keep an explicit link to their original legacy row

## Retrieval rules

- Global knowledge: `match_global_knowledge_context(...)`
- Account context: `match_account_context(...)`
- Legacy retrieval: `match_chunks(...)` is deprecated
- Always filter first, then vector search, then rerank by score + recency
- Only high-quality rows are retrieval candidates
  - global score >= 50
  - script version score >= 50
  - memory weight >= 50

## `match_chunks` removal plan

1. Add `account_id` to legacy MVP tables
2. Stop writing new app logic against `documents/chunks`
3. Move reference-video retrieval into `reference_analyses` + `reference_analysis_chunks`
4. Replace all backend call sites of `match_chunks(...)`
5. Remove legacy `/api/search` dependency on `documents/chunks`
6. Drop `match_chunks(...)` only after no runtime callers remain

## Version rules

- `scripts` holds the current editable/autosave state
- `script_versions` stores immutable snapshots only on:
  - AI generation
  - feedback apply
  - manual save

## Memory rules

- store only distilled memory
  - `preference`
  - `pattern`
  - `success`
- do not store full conversations
- use top 1~2 memories in prompt composition
