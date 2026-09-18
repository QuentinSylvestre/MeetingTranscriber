# Transcribe-default page, TranscriptView UX revamp, exact cost tracking, and docx persistence

> **Date**: 2026-09-18
> **Status**: In Progress
> **Scope**: Six related UX/feature changes to the meeting_transcriber Electron app: default page + rename, TranscriptView button revamp (including .txt→.docx export), default text size, a processing modal, exact per-request cost tracking (transcription + summary), and persisting the compte-rendu JSON so its docx can be re-rendered without re-calling the LLM.
> **Estimated effort**: ~1-2 weeks

---

## Intent

### Problem statement & desired outcomes

The app currently opens on the Record page, uses plain-text export, has no processing modal (transcription is a full page; summary generation is an unguarded inline status line), tracks no API cost anywhere, and discards the paid compte-rendu's structured output the instant its docx is rendered — so recovering from a save failure or wanting a fresh copy later means paying OpenAI again. The user wants:

1. The Upload/Importer page to be the default page on launch, renamed to "Transcrire".
2. Several TranscriptView label/placement revisions (Reset button placement, .txt→.docx export, Copy button label).
3. The default text-size preference raised to the "Très grand" option.
4. A modal spinner shown during transcription and during compte-rendu generation.
5. Exact (not estimated) API cost displayed progressively during processing and in job history.
6. The ability to re-render the compte-rendu docx without re-calling the LLM.

### Success criteria

- **SC-1**: UploadView is the default view on app launch. The French sidebar nav label changes from "Importer" to "Transcrire". English label, the page's own heading text, and internal identifiers (`nav_upload` key, `'upload'` view-id) are unchanged.
- **SC-2**: The "Réinitialiser la transcription" button moves out of the top header button cluster into its own small, right-aligned toolbar directly above the transcript turns list.
- **SC-3**: The transcript export button produces a `.docx` file (replacing `.txt` entirely — not offered as a choice), with button text "Exporter transcript vers .docx". Content mirrors what `.txt` export produces today (speaker name, timestamp, text — respecting the existing `includeTimestamps` preference), rendered as a plain docx document with no additional formatting/styling.
- **SC-4**: The "Copier" button is renamed to "Copier transcript" (behavior unchanged).
- **SC-5**: The default `fontSize` preference becomes 18 (the "Très grand"/"Extra large" option). The "(défaut)"/"(default)" label suffix moves from the 14/Medium option to the 18/XL option.
- **SC-6**: A single shared, reusable modal component (dimmed backdrop, centered card, spinner) is used for both (a) transcription progress — preserving the existing scrolling status log and Cancel button, just restyled as a modal instead of a plain page — and (b) compte-rendu generation — spinner + status message, no cancel button, and its backdrop blocks all TranscriptView interactions underneath (closing the existing gap where Export/Copy/Reset are clickable during a paid, non-cancellable summary request).
- **SC-7**: Exact per-request cost is computed and displayed:
  - Transcription: from each provider's own inline usage/duration field (AssemblyAI `audio_duration` + `speech_model_used`, priced per the actual model tier that ran since AssemblyAI's Universal-3.5-Pro and Universal-2 are billed at different rates; ElevenLabs `audio_duration_secs`; OpenAI `usage.input_tokens`/`output_tokens` — `input_token_details.audio_tokens` is captured as a diagnostic breakdown only, since OpenAI bills all input tokens for this model at one uniform rate, not a separate audio-token rate; Google `usage` token breakdown), multiplied by a per-provider (and, for AssemblyAI, per-tier) rate.
  - Compte-rendu: from OpenAI Responses API's `usage.input_tokens`/`output_tokens`/`input_tokens_details.cached_tokens`, using the currently-unwired `onUsage` hook in `generate.ts`.
  - Rates live in a new Settings "Pricing" section, pre-filled with today's researched defaults, user-editable (multiple fields per provider where the provider's real pricing has multiple components).
  - Displayed progressively: chunk-by-chunk running total for multi-chunk providers (OpenAI, Google) during processing; appears once, at completion, for single-shot providers (AssemblyAI, ElevenLabs) and for the compte-rendu step (none of these expose a real intermediate signal).
  - Partial cost from completed chunks is retained if a multi-chunk job later fails/cancels. No cost (not `$0`) is shown for a job that fails before any billable unit is ever known.
  - Shown as a single total (transcription + summary combined once both exist) on each HistoryView job card, in USD.
  - Incidental fix folded in: since AssemblyAI/ElevenLabs now surface real audio duration in their completed response, `jobs.duration_s` (currently always `null` in practice) gets populated from that real value, making HistoryView's existing (currently dead) duration display actually work.
- **SC-8**: The compte-rendu's validated `MeetingSummary` JSON and a frozen snapshot of the transcript text it was validated against are persisted (one record per job, latest generation replacing any previous one). Whenever a persisted record exists for a job, TranscriptView shows a "Régénérer le document" action that re-renders and re-saves the docx from the stored data — available at any time later, including after an app restart — without a new LLM call. This upgrades (replaces, not duplicates) the existing session-only "Enregistrer à un autre emplacement" retry-save affordance.

### Scope boundaries & non-goals

- No queueing of multiple concurrent transcription jobs (existing one-at-a-time invariant is preserved).
- No history of multiple past compte-rendu generations per job — only the latest is retained (SC-8).
- No editing of pricing rates or cost figures for past jobs beyond what SC-7's Settings section provides going forward.
- No new external service integration — all five API surfaces used for cost data are already called by the app today; only their response parsing widens.
- No fix for the pre-existing `_activeJobId` stuck-forever bug (`runner.ts`, `createJob()` can throw before the `try` block, leaving the singleton permanently set) — reported in Risk Assessment, not in scope to fix here.
- No general DB migration framework beyond the minimal `PRAGMA user_version` runner this project needs.
- No React component-testing infrastructure is introduced — the project has none today (no `@testing-library/react`, no jsdom environment configured), and the new `Modal` component is verified through `/qdev`'s browser-driven QA step instead, consistent with how existing renderer views are verified.

---

## 1) Current State

**Default view & navigation** — `src/renderer/App.tsx:17` `useState<View>('record')` is the default view; `App.tsx:14`'s `View` union is duplicated verbatim in `src/renderer/components/Sidebar.tsx:4`. `Sidebar.tsx:15-20`'s `NAV_ITEMS` array orders `record, upload, history, settings`, with the upload entry at `Sidebar.tsx:17` (`icon: '⬆'`, label from `t('nav_upload')`). i18n key `nav_upload`: `'Upload'` (EN, `src/renderer/i18n.ts:28`) / `'Importer'` (FR, `i18n.ts:188`).

**TranscriptView header** — `src/renderer/views/TranscriptView.tsx:130-153` is one flex row containing, in order: Generate-summary (`:131-134`, disabled while `generatingJobId !== null || turns.length === 0`), Reset (`:135-146`, i18n `transcript_btn_reset`, disabled only by `!hasEdits`, **not** gated by `generatingJobId`), Export (`:147-149`, `t('transcript_btn_export')`, invokes `export:to-file`, **no `disabled` prop**), Copy (`:150-152`, `t('transcript_btn_copy')`, invokes `export:to-clipboard`, **no `disabled` prop**). The turns list itself starts at `:177` (`<div className="transcript-turns">`). i18n: `transcript_btn_reset` FR `'↩ Réinitialiser la transcription'` (`i18n.ts:286`), `transcript_btn_export` FR `'⇩ Exporter .txt'` (`i18n.ts:280`), `transcript_btn_copy` FR `'📋 Copier'` (`i18n.ts:281`).

**Export today** — `src/main/ipc/export.ts:31-60` (`export:to-file`): builds a sanitized `.txt` filename, shows a native save dialog filtered to `Text`/`.txt` (`:47-51`), formats via local `formatTranscript()` (`:11-25`, which calls `formatLine()` from `./format-line.ts:11-13`), and does `fs.writeFileSync(result.filePath, text, 'utf-8')` (`:57`). `formatLine(name, startMs, text, includeTimestamps)` returns `` `${formatTime(startMs)} ${name}: ${text}` `` or `` `${name}: ${text}` ``. `readPreferences().includeTimestamps` (`src/main/settings/store.ts:16` default `true`) already gates this.

**Font size** — single source of truth for the default is `DEFAULT_PREFERENCES.fontSize = 14` at `src/main/settings/store.ts:17`. Two independent, hardcoded `14` fallbacks exist and must be updated in lockstep: `App.tsx:33` (`[14,16,18,20].includes(value) ? value : 14`) and `SettingsView.tsx:26,59` (same pattern). `src/main/ipc/settings.ts:38` already allows `18` (`![14,16,18,20].includes(value)`) — no change needed there. Select options at `SettingsView.tsx:226-229`; labels at `i18n.ts:159-162` (EN) / `i18n.ts:303-306` (FR) — the `'(défaut)'`/`'(default)'` suffix is hardcoded onto the 14/Medium label text itself (`i18n.ts:159,303`), not derived from the actual default.

**No modal/dialog/spinner UI exists anywhere in `src/renderer`** (confirmed by grep across `components/`, `styles/global.css` — the only hits are Catppuccin `--overlay0/1/2` color tokens and Electron's native `dialog.showSaveDialog`; zero matches for `position:\s*fixed|z-index|backdrop`). `JobProgressView.tsx` (85 lines) is a full page: header (`:42-47`), `.progress-bar-track`/`.progress-bar-fill` (`global.css:544-557`, an indeterminate `@keyframes` animation at `:559-563` — no real percentage anywhere in the pipeline), a scrolling `.progress-log` div (`global.css:527-538`, `JobProgressView.tsx:63-73`, `aria-live="polite"`), and a Cancel button (`:76-82`) calling `transcription:cancel-job`. `TranscriptView.tsx:19` `summarizing = generatingJobId === jobId`; `:162` renders only `<p role="status">{t('summary_working')}</p>` while true — no spinner, no blocking of any kind.

**Provider adapters — none expose usage/cost/duration today** (verified by reading all four in full):
- `src/main/providers/assemblyai.ts:95-99` casts the poll response to `{ status: string; error?: string; utterances?: Array<{speaker,start,end,text}> }`; the real AssemblyAI transcript object also carries `audio_duration` (seconds) and `speech_model_used` (which of Universal-3.5-Pro/Universal-2 was actually used, determining the billing tier) — confirmed via AssemblyAI's own API reference, neither field is read today. Returns exactly one `TranscriptChunkResult` per call (`:110`, `[{ chunkIndex: 0, turns }]`).
- `src/main/providers/elevenlabs.ts:45-53` casts to `{ words?: Array<{type,speaker_id,text,start,end}> }`; the real response also carries a top-level `audio_duration_secs`. Returns one result per call (`:98`).
- `src/main/providers/openai.ts:74-76` casts to `{ segments?: Array<{speaker,start,end,text}> }`; the real `gpt-4o-transcribe-diarize` response is expected to also carry a token-based `usage` object (`input_tokens`, `output_tokens`, `input_token_details.audio_tokens`) — confirmed for the gpt-4o transcription family generally, **not confirmed by name for this exact diarize variant** in any documentation found (see Risk Assessment). Returns one result per call (`:88`).
- `src/main/providers/google.ts:29` sends the bare model id `'gemini-3.5-transcribe'` (verified directly — no `-preview` suffix), matching the pricing page found in research. `:125` casts the response to `{ steps?: Step[] }`; the real Interactions API response also carries a top-level `usage` field (token breakdown by modality) per Google's formal API reference — **not demonstrated in Google's own abbreviated transcription-guide example** (see Risk Assessment). Returns one result per call (`:190`).
- `src/main/providers/types.ts:19-28` (`TranscriptChunkResult { chunkIndex; turns }`) and `:30-38` (`TranscriptionProvider.transcribeFile(...): Promise<TranscriptChunkResult[]>`) are the shared contract every adapter implements — no usage/billing field exists in either today.
- **Runner already calls `transcribeFile` once per chunk file** (`src/main/transcription/runner.ts:104-137`): for single-shot providers (AssemblyAI, ElevenLabs) `chunkResult.paths.length === 1`, so the loop runs once; for OpenAI/Google, `chunkAudio()` (not modified by this plan) produces multiple chunk files, so the loop runs multiple times. This means "reveal cost chunk-by-chunk for multi-chunk providers, once at the end for single-shot providers" falls directly out of this existing loop structure — no per-provider special-casing is needed once each adapter's per-call result optionally carries usage data.

**Compte-rendu / summary generation** — `src/main/summary/generate.ts:33` `SummaryOptions.onUsage?: (usage: unknown) => void` (doc comment: "Receives the provider's token accounting, when it reports any... Overrides used only by the offline evaluation harness; production passes nothing"); `:64-70` reads `payload.usage` from the raw OpenAI Responses API JSON and calls `options.onUsage?.(payload.usage)`; the production call site `src/main/ipc/summary.ts:95` (`await generateSummary(transcript, apiKey, durationMs)`) passes **no 4th argument**, so this has always been a no-op in the shipped app. `render-docx.ts:212`: `export async function renderSummaryDocx(summary: MeetingSummary, transcript?: string): Promise<Buffer>` — a pure function of the validated JSON plus the transcript text; `transcript` is used inside `evidenceStamp()` (`:112-118`, called via `renderTopic()` at `:160,227,230`) to look up which audio timestamp an evidence quote falls under, returning `null` (not throwing) when the quote isn't found in the given transcript string.

**`ipc/summary.ts` state today** (`registerSummaryHandlers`, `:30-142`): `let busy = false` (`:31`, process-wide, gates `summary:generate` only — `summary:retry-save` does not set it); `savedPaths: Map<jobId,filePath>` (`:34`) and `unsaved: Map<jobId,Buffer>` (`:37`) are both main-process-memory-only, lost on restart. `summary:generate` (`:69-117`): resolves the transcript, shows the save dialog **before** the paid call (`:87-93`, "cancelling costs nothing"), calls `generateSummary` (`:95`), renders (`:100`), writes atomically via a `.tmp`-then-`rename` helper (`:19-28`, `writeAtomically`), and on write failure stores the buffer in `unsaved` (`:109`) so `summary:retry-save` (`:120-126`) can re-attempt the write via a shared `save()` helper (`:39-67`) without re-billing. The validated `MeetingSummary` object returned at `:95` is never stored anywhere and becomes unreachable the moment the handler returns.

**DB schema & migration mechanism** — `src/main/db/index.ts:15-52` embeds one `MIGRATION_001` SQL string (`jobs`, `transcript_turns`, `speaker_mappings` tables, one index), applied via `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` inside a transaction (`:70-77`) on **every** app startup — a no-op on an already-created table. `src/main/db/migrations/001_initial.sql` is a byte-identical copy, read only by `tests/unit/db.test.ts` (not at runtime, per the comment at `index.ts:8-12`). No `PRAGMA user_version`/`ALTER TABLE`/schema-version mechanism exists anywhere in application code today (grep-confirmed). `src/main/index.ts:45-47` confirms `registerAllHandlers()` (which calls `initDb()` first, `ipc/index.ts:18`) runs inside `app.whenReady().then(...)`. The project's own two-day-old precedent (`plans/260916_TRANSCRIPT_EDIT_TIMESTAMP_FONTSIZE.md`) for adding a column to the *live dev* database was a **manual** `ALTER TABLE` + timestamped `.bak` copy, run by hand once, with both schema-source files updated afterward to match — no runtime migration code resulted from it. `jobs.ts:4-10` (`createJob`) and `:12-26` (`updateJobStatus`) both hardcode explicit column lists — a new column does not flow through automatically; it needs its own read/write path. `db:get-job`/`db:list-jobs` (`ipc/db.ts:15-21`) return `jobs.getJob`/`jobs.listJobs` verbatim (`SELECT *`), so once a column exists it reaches the renderer with no extra wiring.

**IPC/preload plumbing** — `InvokeChannel` (`shared/ipc-types.ts:252`) is derived from `IpcChannels`; `src/preload/index.ts:12-14`'s `ipcApi.invoke` is typed against it, so a new *invoke* channel needs only an `IpcChannels` entry plus an `ipcMain.handle(...)` registration inside one of the `register*Handlers()` functions called from `ipc/index.ts:15-28` — preload itself needs no change. A new **push** event would need the hand-maintained `PushChannel` union at `preload/index.ts:6` extended manually — **this plan avoids that entirely** by extending the existing `transcription:progress` event's payload (`{jobId, status}` → `{jobId, status, costUsd?}`) rather than adding a new channel. `src/renderer/global.d.ts:11-19` declares `window.electronAPI.invoke(channel: string, ...)` untyped — a pre-existing gap (channel-name typos aren't caught by the type system at any renderer call site), not introduced or fixed by this plan.

**Settings/preferences plumbing** — `src/main/settings/store.ts:101-111` (`readPreferences`) does `{ ...DEFAULT_PREFERENCES, ...raw }`, so a new `PreferenceKey` just needs a default added to `DEFAULT_PREFERENCES` (`:11-18`) and a type added to `Preferences` (`shared/ipc-types.ts:258-265`) — the get/set plumbing (`store.ts:113-124`) is fully generic. The one place that needs an explicit per-key edit is `src/main/ipc/settings.ts:31-39`'s `settings:set-preference` handler: a closed if/else validation chain (`:32-38`) plus a final catch-all allowlist array (`:39`) that silently **drops** the write if the key isn't in either — a new preference key must be added to both.

**No fixture in the repo captures a real provider HTTP response body** — only transcript-level golden data exists under `tests/fixtures/municipal-summary/` (`golden-summary.json`, 29,573 bytes on disk — trivially small for a SQLite `TEXT` column). New unit tests for the widened provider adapters need hand-built synthetic response fixtures, following the existing per-provider mocking pattern in `tests/unit/providers/*.test.ts`.

**No React component-testing infrastructure exists** — `package.json` has `@types/react`/`@types/react-dom` but no `@testing-library/react` and no jsdom test environment; `tests/unit/transcript-view.test.ts` tests only pure functions (`formatTime`/`formatLine`, URL construction), never renders a component. New UI (the `Modal` component) is verified manually via `/qdev`'s browser-driven QA, matching how every other existing view is verified.

## 2) Goal

Introduce a minimal `PRAGMA user_version` migration runner to add a `jobs.cost_usd` column and a `job_summaries` table; widen all four provider adapters and the summary generator to surface their already-available billing data; add a Settings-editable per-provider pricing table and a pure cost-calculation module; wire real, incremental cost into the transcription runner and the summary handler, surfaced progressively via the existing `JobProgressView` and in `HistoryView`; build one shared `Modal` component used for both transcription progress and (newly) compte-rendu generation; persist the compte-rendu's JSON + transcript snapshot so it can be re-rendered/re-saved without a new LLM call; and apply the remaining small, low-risk UX changes (default page, button labels/placement, default font size).

## 3) Design Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Schema evolution mechanism | Minimal `PRAGMA user_version` migration runner in `db/index.ts`; migration 002 adds `jobs.cost_usd` + `job_summaries` table | (a) One-off manual `ALTER TABLE` against the live dev DB, matching the existing two-day-old precedent, with no reusable runtime mechanism | User explicitly chose "a+b" — build the mechanism now and use it, rather than repeat the manual approach a second time (Q1) |
| Cost accuracy | Exact — billable-unit × published rate, no estimation | Estimate transcription cost from a locally-probed audio duration (the pre-research recommendation) | User rejected estimation outright ("exact cost or nothing"); research confirmed all five API surfaces return the exact billable unit inline, making an estimate unnecessary (Q2) |
| Cost-query mechanism | None — compute locally from data already in each response | A separate provider cost-query API call after each job | Research found no provider's separate cost-query endpoint (where one exists) resolves to single-request granularity; OpenAI's additionally requires an Admin key the app doesn't hold (Q2-research) |
| Pricing rate storage | Structured, Settings-editable preference (`pricingRates: PricingRates`, one object, defaulted from researched values) | Hardcoded constants requiring a code change to update | Confirmed rate drift risk (OpenAI's promotional rate expires 2026-11-21; AssemblyAI's page is ~4 months stale) makes a code-only constant an operational liability (Q3) |
| `jobs.cost_usd` semantics | Monotonically accumulating total across the job's lifetime (`cost_usd = COALESCE(cost_usd,0) + increment`), never overwritten | Store the latest summary's cost separately from transcription cost, or overwrite on each summary regeneration | A regenerated compte-rendu is genuinely a second paid request; overwriting would understate real spend when SC-8's "latest JSON replaces previous" is exercised more than once |
| Progressive cost signal | Extend the existing `transcription:progress` push event payload with an optional `costUsd` field | Add a new dedicated push channel (e.g. `transcription:cost-update`) | Avoids touching the hand-maintained `PushChannel` union in `preload/index.ts`; the existing per-chunk loop in `runner.ts` already provides the right cadence |
| Provider usage shape | One shared discriminated union `ProviderUsage = {kind:'duration', seconds, modelUsed?} \| {kind:'tokens', inputTokens, outputTokens, audioTokens?, cachedTokens?}` added to `TranscriptChunkResult` | A separate ad-hoc shape per provider | One calculation function per billing model (duration-based vs. token-based) instead of four bespoke ones; matches the two billing models research actually found |
| Docx re-render / retry-save unification | Persist the JSON + transcript snapshot to `job_summaries` immediately after `generateSummary()` succeeds (before attempting to render/write); remove the in-memory `unsaved` Map and the `summary:retry-save` channel entirely; both "recover from a save failure" and "regenerate anytime" now call the same new `summary:rerender` channel, gated by a `hasStoredSummary` flag from `summary:state` | Keep `unsaved`/`summary:retry-save` alongside a new, separate `summary:rerender` channel | Two channels answering the same underlying question ("can I get this docx again without paying?") is exactly the kind of duplicate/parallel logic the Senior-engineer review persona flags; once the JSON is durably persisted, the in-memory fast path adds no capability and only adds a second thing to keep in sync. Directly implements Q9's "upgrade, don't duplicate" decision |
| Modal blocking mechanism | A single `position: fixed` full-viewport backdrop (via the shared `Modal` component) intercepts all clicks on whatever renders behind it | Individually add a `disabled` prop to Export/Copy/Reset during `summarizing` | One component closes the gap for all current and future buttons in the view, rather than an enumerable, easy-to-forget per-button guard (Q5) |
| AssemblyAI rate structure | Per-tier rates keyed by `speech_model_used` (Universal-3.5-Pro vs. Universal-2), not one flat rate | One flat `perHourUsd` for AssemblyAI regardless of which model actually ran | Research shows these two tiers are billed at genuinely different rates ($0.21/hr vs $0.15/hr); the app's own request lists both as acceptable models (`speech_models: ['universal-3-5-pro','universal-2']`), so a fallback to the cheaper tier is a real possibility a flat rate would mis-price (review findings: Domain expert #2, Senior engineer #2) |
| OpenAI transcribe `audioTokens` field | Captured on `ProviderUsage` for diagnostic/future use, not consumed by `calculateTranscriptionCost` today | Add a separate audio-token rate and use it in the cost formula | Research found OpenAI's `gpt-4o-transcribe-diarize` pricing page documents one uniform per-input-token rate with no separate lower rate for the audio-token subset — using `audioTokens` in the formula would double-count or misprice against the single documented rate (review findings: Domain expert #1, Senior engineer #2) |
| Migration atomicity | The `PRAGMA user_version = 2` bump is the last statement inside `MIGRATION_002`'s own SQL text, so it commits in the same transaction as the `ALTER TABLE`/`CREATE TABLE` | Bump the version via a separate `.pragma()` call after the transaction commits (the original sketch) | A crash between a committed `ALTER TABLE` and an un-committed version bump would leave `user_version` at 1, so the next launch re-attempts the non-idempotent `ALTER TABLE` and throws "duplicate column name" forever (review finding: Reliability engineer #1, High) |
| Migration backup completeness | Run `PRAGMA wal_checkpoint(TRUNCATE)` immediately before copying `db.sqlite`, and skip the backup entirely on a fresh install, detected via `fs.existsSync(dbPath)` checked before the file is opened (**corrected during `/qdev` Phase 1 implementation** — the plan's original sketch used `PRAGMA user_version === 1` as the fresh-vs-existing signal, but `user_version` reads `0` for both a brand-new file and every database that predates this versioning scheme, including the app's real production `db.sqlite` — see Implementation Divergences) | Copy `db.sqlite` alone, unconditionally | The app runs in WAL mode; a plain file copy can silently miss recently-committed data still sitting in `db.sqlite-wal`. A checkpoint merges the WAL into the main file first, so the copy is complete; skipping the backup on a fresh install (no real prior data to protect) avoids a needless `.bak-pre-v2-*` file on every new user (review findings: Architect #2, Reliability engineer #2, High; Senior engineer #6, Low) |
| Cost-bookkeeping failure isolation | `updateJobCost`/duration-fix writes inside the transcription loop are wrapped in their own try/catch that logs and continues | Let a cost-write failure propagate like any other loop error | A DB error in cost bookkeeping (e.g. `SQLITE_BUSY`) must not discard already-fetched, already-paid-for turns or fail the whole job — cost tracking is a secondary concern to turn-saving (review finding: Reliability engineer #3, High) |
| Summary-persistence failure handling | `saveSummaryRecord` is wrapped in its own try/catch, returns a distinct `persist_failed` error code (never `provider_error`), and keeps a narrow, session-only in-memory fallback of the just-generated JSON+transcript for exactly this failure window | Let an uncaught throw fall into the handler's existing catch-all | The existing code's own stated invariant is "a local failure must never be reported as a provider problem"; with `unsaved` removed, a `saveSummaryRecord` throw right after a paid call would otherwise make the paid result unrecoverable with no trace (review finding: Reliability engineer #4, High) |
| `summary:rerender` concurrency guard | `summary:rerender` checks/sets the same `busy` flag `summary:generate` uses, keyed per job id | Leave `rerender` unguarded, relying only on the renderer's single-flight UI state | `rerender` opens an unbounded native save dialog; without a shared guard it can race a concurrent `summary:generate` for the same job and let a stale render overwrite a fresh one (review findings: Architect #8, Reliability engineer #6, Medium) |

## 4) External Dependencies & Costs

### Required external changes

| Category | Change needed | Owner | Status |
|---|---|---|---|
| CI/CD | None | — | N/A |
| IAM / Permissions | None | — | N/A |
| Cloud resources | None — all five API surfaces are already called with the user's own keys | — | N/A |
| Data migration / backfill | Yes — see Phase 1 (schema migration) and Phase 1's backup step | User (runs the app once after upgrading) | Pending |
| Rollout / cutover | None — single-user desktop app, no phased rollout | — | N/A |
| Cleanup after rollback window | None | — | N/A |
| Secrets / Env vars | None — no new secrets; pricing rates are non-sensitive preferences | — | N/A |
| DNS / Networking | None | — | N/A |
| Third-party services | None new — AssemblyAI/ElevenLabs/OpenAI/Google are already integrated | — | N/A |

No new runtime artifacts (data files, templates, static assets, native binaries) are introduced — `docx` (already a dependency, v9.7.1) is reused for the new transcript-export renderer.

### Cost impact

No new recurring cost. This feature is entirely about *displaying* cost the app already incurs, not incurring new cost. Manual end-to-end verification (Phase 5, 7, 8's QA steps) requires real API calls against the user's own configured providers and will incur small real charges, consistent with this project's existing testing-cost precedent (~$5-10/provider, documented in the founding plan `plans/done/260913-2146_MEETING_TRANSCRIBER_ELECTRON_APP.md`). No explicit approval gate is required beyond what routine development already assumes, since these are the same API calls the app already makes in normal use.

## 5) Implementation Phases

**Vertical phasing rule applied**: Phases 2, 3, 4, 6, 7, 8 are vertical feature slices. Phases 1 and 5 are horizontal (justified below) because they are shared foundations two later vertical phases each depend on.

### Phase 1: DB migration runner + schema for cost and summary persistence [QA]

**Goal**: Introduce a `PRAGMA user_version`-based migration runner and use it to add `jobs.cost_usd` and a new `job_summaries` table, safely, to the user's existing `db.sqlite`.

**Why horizontal**: Phase 7 (transcription cost) needs `jobs.cost_usd` to exist and Phase 8 (docx persistence) needs `job_summaries` to exist. Building the migration mechanism inside either phase would force the other to either duplicate the runner scaffolding or block on the first phase's completion for an unrelated reason; the migration mechanism itself is shared infrastructure neither phase would naturally own.

**File scope**: `src/main/db/index.ts`, `src/main/db/migrations/002_add_cost_and_summaries.sql` (new), `src/main/db/summaries.ts` (new), `src/main/db/jobs.ts`, `src/shared/ipc-types.ts` (`Job.cost_usd`), `tests/unit/db.test.ts`.

**Changes**:

1. In `src/main/db/index.ts`, add a `MIGRATION_002` string (mirroring the existing `MIGRATION_001` embedding pattern) and a matching on-disk copy at `src/main/db/migrations/002_add_cost_and_summaries.sql`. The version bump is the **last statement inside this same SQL text**, not a separate call, so it commits atomically with the schema change:
   ```sql
   ALTER TABLE jobs ADD COLUMN cost_usd REAL;

   CREATE TABLE IF NOT EXISTS job_summaries (
     job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
     summary_json TEXT NOT NULL,
     transcript_snapshot TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );

   PRAGMA user_version = 2;
   ```
2. Replace `initDb()`'s single `migrate()` transaction (`index.ts:70-77`) with a version-gated sequence. **As implemented (corrected from this section's original sketch — see Implementation Divergences)**: the backup gate uses `dbAlreadyExisted = fs.existsSync(dbPath)`, captured *before* `new Database(dbPath)` opens/creates the file, instead of `PRAGMA user_version === 1`. `PRAGMA user_version` reads `0` for both a brand-new file and every database that predates this versioning scheme — including the real, populated `db.sqlite` this app already ships — so the originally-sketched `version === 1` gate (checked against a pre-bump value) would have silently skipped the backup on exactly the transition it exists to protect:
   ```ts
   const dbAlreadyExisted = fs.existsSync(dbPath);
   // ... new Database(dbPath), journal_mode, foreign_keys, busy_timeout ...
   const migrate1 = _db.transaction(() => { _db!.exec(MIGRATION_001); });
   migrate1();
   const version = _db.pragma('user_version', { simple: true }) as number;
   if (dbAlreadyExisted && version < 2) {
     // Safety net mirroring this project's own established precedent for schema
     // changes against a live personal database. A fresh install
     // (dbAlreadyExisted === false, no real data yet) skips the backup entirely.
     // WAL mode means recent commits can still live only in `-wal`; checkpoint
     // merges them into the main file first so the copy is a complete snapshot.
     _db.pragma('wal_checkpoint(TRUNCATE)'); // busy flag checked, logged if truthy
     fs.copyFileSync(dbPath, `${dbPath}.bak-pre-v2-${Date.now()}`);
   }
   if (version < 2) {
     // PRAGMA user_version = 2 is the last statement inside MIGRATION_002 itself,
     // so the schema change and the version bump commit as one atomic unit — a
     // crash between them is impossible by construction, unlike a separate
     // post-transaction .pragma() call would allow.
     const migrate2 = _db.transaction(() => { _db!.exec(MIGRATION_002); });
     migrate2();
   }
   ```
   `MIGRATION_001` stays `CREATE TABLE IF NOT EXISTS`-only (unchanged, still safe to re-run every startup); `MIGRATION_002`'s `ALTER TABLE` is *not* idempotent, which is why it is gated behind the `user_version` check rather than run unconditionally — the guard is what makes it safe to run once and never again.
3. Add `cost_usd: number | null` to the `Job` interface (`shared/ipc-types.ts:5-17`).
4. Add `db/summaries.ts` (new file) with `saveSummaryRecord(jobId, summaryJson, transcriptSnapshot)` (upsert via `INSERT ... ON CONFLICT(job_id) DO UPDATE`) and `getSummaryRecord(jobId): JobSummaryRecord | null` — consumed by Phase 8. Not a new *directory* under `src/main/`, so per this project's `AGENTS.md` Doc & Test Guidelines its tests are added to the existing `tests/unit/db.test.ts` rather than a new test file.
5. Add `updateJobCost(id: string, incrementUsd: number): void` to `db/jobs.ts`: `UPDATE jobs SET cost_usd = COALESCE(cost_usd, 0) + @increment WHERE id = @id` — consumed by Phase 7 and Phase 8.
6. Update `tests/unit/db.test.ts` to exec `002_add_cost_and_summaries.sql` immediately after `001_initial.sql` when seeding its in-memory test DB (it currently execs only `001_initial.sql` directly, per `db.test.ts:33-44`) — otherwise the test schema silently drifts from the real one. Add test cases: `updateJobCost` accumulates rather than overwrites across two calls; `saveSummaryRecord`/`getSummaryRecord` round-trip; `job_summaries` cascades on `deleteJob` (mirroring the existing cascade-delete test pattern for `transcript_turns`/`speaker_mappings`).

**Rejected**: bumping `user_version` via a separate `.pragma()` call after `MIGRATION_002`'s transaction commits — a crash in that gap would leave the version at 1 and cause every subsequent launch to re-run the non-idempotent `ALTER TABLE`, throwing "duplicate column name" forever. Putting the `PRAGMA user_version = 2` statement inside `MIGRATION_002`'s own SQL text makes the schema change and the version bump one atomic transaction instead.

**Exit criteria**:
- [x] `npm test` passes with all 16 (now: same count, `db.test.ts` extended in place) files green.
- [x] A manual run against a **copy** of the real `userData/db.sqlite` (never the live file) confirms: existing jobs and transcripts are unchanged after migration; `jobs.cost_usd` exists and is `NULL` for all pre-existing rows; `job_summaries` exists and is empty; a `.bak-pre-v2-*` file was created next to the copy and is byte-consistent (write a row, checkpoint, copy, then diff the backup against a fresh checkpoint — they must match).
- [x] A restore-from-backup dry run succeeds: rename the copy's live file aside, rename `.bak-pre-v2-*` into its place, and confirm the app opens it with all pre-migration data intact and readable.
- [x] Running the app twice in a row (fresh install, then restart) does not re-run `MIGRATION_002` a second time (confirm via a log line or breakpoint — `user_version` should read `2` after the first run and the `ALTER TABLE` must not execute again, which would throw "duplicate column name").
- [x] A fresh install (no pre-existing `db.sqlite`) produces **no** `.bak-pre-v2-*` file — the backup only fires when upgrading an existing installation.
- [x] `db.sqlite.bak-pre-v2-*` backup file is created before `MIGRATION_002` runs, confirmed by file timestamp preceding the schema change, on an existing (non-fresh) install.

**Implementation (2026-09-18, code: d130e6a, fixes: 97bd9dd)**

Added a `PRAGMA user_version`-based migration runner to `src/main/db/index.ts` and used it to add `jobs.cost_usd` and a new `job_summaries` table to the schema, safely, on top of the existing always-reapplied `MIGRATION_001`.

`MIGRATION_002` (`ALTER TABLE jobs ADD COLUMN cost_usd REAL; CREATE TABLE IF NOT EXISTS job_summaries (...); PRAGMA user_version = 2;`) is embedded as a template literal in `index.ts` (mirroring `MIGRATION_001`'s existing pattern) with a byte-identical on-disk documentation copy at `src/main/db/migrations/002_add_cost_and_summaries.sql`. The version bump is the last statement inside the migration's own SQL text, so it commits atomically with the schema change inside one `better-sqlite3` transaction — a crash between the `ALTER TABLE` and the version bump is impossible by construction.

`initDb()` now: runs `MIGRATION_001` unconditionally (unchanged, idempotent); reads `user_version`; if the database file existed on disk before this call opened it (`fs.existsSync`, checked pre-open) and `user_version < 2`, checkpoints the WAL (`wal_checkpoint(TRUNCATE)`) and copies `db.sqlite` to `db.sqlite.bak-pre-v2-<timestamp>` next to it; then, if `version < 2`, runs `MIGRATION_002`. A brand-new install never triggers the backup, and a restart on an already-migrated install is a no-op past the guard.

New `src/main/db/summaries.ts` exports `saveSummaryRecord`/`getSummaryRecord` (upsert keyed on job_id, normalizing better-sqlite3's `undefined`-on-no-match to `null`). `src/main/db/jobs.ts` gained `updateJobCost` (accumulates via `COALESCE(cost_usd,0) + increment`); `createJob`'s parameter type narrowed to `Omit<Job, 'cost_usd'>` since a job never carries a cost at creation. `tests/unit/db.test.ts` extended with `updateJobCost` accumulation, a `saveSummaryRecord`/`getSummaryRecord` round-trip, and `job_summaries` cascade-on-delete coverage.

Review fixes (commit `97bd9dd`): the migration path now wraps its backup/schema-change sequence in try/catch with `log.info`/`log.error`, mirroring `MIGRATION_001`'s existing pattern, with best-effort cleanup of a partial backup file on failure; added `busy_timeout = 5000` and a check of the WAL checkpoint's own `busy` flag (logged, not blocking) to make a concurrent-access hazard diagnosable; added real (unmocked, via `vi.importActual`) test coverage of `initDb()`'s fresh-install/upgrade/restart paths, closing a gap where the actual migration-gating logic had zero automated regression coverage; removed a vestigial `PRAGMA user_version = 1` write that was always immediately overwritten by `MIGRATION_002`'s own trailing version bump in the same call; and added `cost_usd` to the (unused) `db:create-job` IPC channel's request type for consistency with `createJob`'s own signature.

Follow-up fix (code: 53d8ad2, user-approved during review): `app.requestSingleInstanceLock()` in `src/main/index.ts`, so a second launch attempt quits immediately (before registering handlers, opening a DB connection, or creating a window) and the already-running instance restores/focuses its existing window instead — the broader mitigation for the concurrency hazard the `busy_timeout` fix only narrows. Verified with a real two-process manual launch: the second instance exited in ~1.2s with no second DB-init log line and no effect on the first instance; all processes cleanly torn down afterward with none left running.

**Unplanned incident**: mid-implementation, a stray already-running `npm run dev` instance (started earlier by the orchestrator while testing QA tooling, imperfectly terminated) auto-restarted on the implementer's `index.ts` save and ran the new `initDb()` for real against the live production `db.sqlite`, before the implementer's own controlled copy-based verification. The orchestrator independently re-verified read-only afterward: `user_version=2`, `integrity_check=ok`, all 4 pre-existing jobs and 841 transcript turns intact, `cost_usd` NULL on all rows, `job_summaries` empty, and a correct `db.sqlite.bak-pre-v2-*` backup created beforehand. No data was lost; this is now also documented as a Harness Improvement Opportunity and directly informed the concurrency-hazard review findings above.

### Phase 2: Default page + font-size default [QA]

**Goal**: UploadView becomes the default view; French sidebar label renamed; default text size raised to 18px with the "(défaut)" suffix relabeled correctly. (SC-1, SC-5)

**Covers**: SC-1, SC-5

**File scope**: `src/renderer/App.tsx`, `src/renderer/i18n.ts`, `src/main/settings/store.ts`, `src/renderer/views/SettingsView.tsx`.

**Changes**:
1. `App.tsx:17`: `useState<View>('record')` → `useState<View>('upload')`. `App.tsx:33`'s fallback stays `14` only as the *invalid-value* fallback (unchanged — it's not the "default view" concept, it's a defensive clamp); update its literal default to `18` per below.
2. `i18n.ts:188`: `nav_upload: 'Importer'` → `nav_upload: 'Transcrire'`. Leave `i18n.ts:28` (`'Upload'`, EN) and `UploadView.tsx`'s own `upload_title`/`upload_subtitle` text unchanged, per Q6.
3. `store.ts:17`: `fontSize: 14` → `fontSize: 18`.
4. `App.tsx:33` and `SettingsView.tsx:26,59`: the `[14,16,18,20].includes(value) ? value : 14` fallback becomes `... : 18` in all three places (the fallback must track the real default, or a corrupted/missing preference value would silently resolve to the *old* default rather than the new one).
5. `i18n.ts:159,303` (`settings_fontsize_medium`): drop the `' (default)'`/`' (défaut)'` suffix, leaving plain `'Medium'`/`'Moyenne'`. `i18n.ts:161,305` (`settings_fontsize_xl`): add the suffix, becoming `'Extra large (default)'`/`'Très grand (défaut)'`.

**Exit criteria**:
- [ ] Fresh app launch (no existing `preferences.json`) opens on the Transcrire/Upload page.
- [ ] Sidebar shows "Transcrire" in French, "Upload" in English.
- [ ] A fresh install's default text size renders at 18px (`--font-size-base`); Settings shows "Très grand (défaut)" selected.
- [ ] An existing `preferences.json` with no `fontSize` key (or a corrupted one) still resolves to 18px, not 14px.

### Phase 3: TranscriptView button revamp — Reset placement, docx export, Copy rename [QA]

**Goal**: Move Reset above the turns list; replace `.txt` export with a plain `.docx` export; rename Copy. (SC-2, SC-3, SC-4)

**Covers**: SC-2, SC-3, SC-4

**File scope**: `src/renderer/views/TranscriptView.tsx`, `src/renderer/i18n.ts`, `src/main/ipc/export.ts`, `src/main/export/transcript-docx.ts` (new), `tests/unit/export/transcript-docx.test.ts` (new), `README.md`.

**Changes**:
1. `TranscriptView.tsx:130-153`: remove the Reset button (`:135-146`) from the header row. Add a small new toolbar row directly above `<div className="transcript-turns">` (`:177`), right-aligned, containing only the Reset button (same `onClick`/`disabled`/confirm logic, unchanged).
2. `i18n.ts:132/281` (`transcript_btn_copy`): EN `'📋 Copy'` → `'📋 Copy transcript'`; FR `'📋 Copier'` → `'📋 Copier transcript'`.
3. `i18n.ts:131/280` (`transcript_btn_export`): EN `'⇩ Export .txt'` → `'⇩ Export transcript to .docx'`; FR `'⇩ Exporter .txt'` → `'⇩ Exporter transcript vers .docx'`.
4. New `src/main/export/transcript-docx.ts` exporting `renderTranscriptDocx(turns, mappings, includeTimestamps): Promise<Buffer>` — reuses the same speaker-name-resolution and `formatLine()`-equivalent logic as `export.ts`'s existing `formatTranscript()` (`export.ts:11-25`), but emits one `docx` `Paragraph` per line instead of one joined string, using the same minimal `docx` primitives already used in `render-docx.ts` (a title heading + plain paragraphs, no tables, no bullets, no bold — matching SC-3's "no additional formatting" requirement). This is placed in a **new `src/main/export/` directory** rather than inside `src/main/summary/` (which owns compte-rendu generation, a different concern) or bolted onto `ipc/export.ts` directly — being a genuinely new directory under `src/main/`, it qualifies for a new test file per this project's `AGENTS.md` Doc & Test Guidelines, rather than requiring an invented exception.
5. `export.ts:31-60` (`export:to-file` handler): change the save-dialog filter from `{name:'Text', extensions:['txt']}` to `{name:'Word Document', extensions:['docx']}`, `defaultPath` extension from `.txt` to `.docx`, and replace the `fs.writeFileSync(..., text, 'utf-8')` call with `fs.writeFileSync(result.filePath, await renderTranscriptDocx(...))`. The IPC channel name `export:to-file` and its request/response shape are unchanged — this is a content-format change, not an API change.
6. `README.md:72`: update `"**Export ⇩** saves the transcript to a `.txt` file."` to describe `.docx` output instead. `README.md:75`: reword the sentence introducing the transcript line-format (`` `[HH:MM:SS] Speaker Name: text` `` — this format itself is unchanged, per SC-3) so it no longer implies a `.txt` file is produced; state that this is now the paragraph content of the generated Word document. (Per the doc-impact sub-agent's findings — the plan's own earlier self-check incorrectly called these a false-positive; they are real, currently-true statements this phase makes false.)

**Rejected**: keeping `.txt` export as a second button alongside `.docx` — the user explicitly confirmed full replacement (Q9), and two export buttons for the same underlying data would be UI clutter with no stated need.

**Exit criteria**:
- [ ] Reset button renders directly above the transcript turns list, not in the header.
- [ ] Clicking "Exporter transcript vers .docx" produces a valid `.docx` file (opens in Word/LibreOffice) containing the same speaker/timestamp/text content the old `.txt` export produced, with timestamps present/absent according to the `includeTimestamps` preference.
- [ ] Copy button copies to clipboard exactly as before (unchanged behavior), with the new label.
- [ ] `npm test` passes; `tests/unit/export/transcript-docx.test.ts` confirms line count and timestamp-inclusion toggle.
- [ ] `README.md` lines 72 and 75 updated to describe `.docx` output; no remaining reference to `.txt` transcript export in `README.md`.

### Phase 4: Shared Modal component + transcription progress restyle [QA] [P:5]

**Goal**: Build one reusable `Modal` component and use it to restyle `JobProgressView` as a modal (same content, new presentation). (SC-6, transcription half)

**Covers**: SC-6 (partial — transcription side; the summary-generation side is completed in Phase 8)

**File scope**: `src/renderer/components/Modal.tsx` (new), `src/renderer/styles/global.css`, `src/renderer/views/JobProgressView.tsx`.

**Changes**:
1. New `Modal.tsx`:
   ```tsx
   interface ModalProps {
     title: string;
     children?: React.ReactNode;
     onCancel?: () => void;
     cancelLabel?: string;
   }
   export default function Modal({ title, children, onCancel, cancelLabel }: ModalProps): React.ReactElement {
     return (
       <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
         <div className="modal-card">
           <div className="modal-spinner" aria-hidden="true" />
           <div className="modal-title">{title}</div>
           {children}
           {onCancel && <button className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>}
         </div>
       </div>
     );
   }
   ```
   (Sketch — implementer follows the project's existing component conventions, e.g. `AudioPlayer.tsx`'s prop/ref style, for anything not shown here.)
2. New CSS in `global.css` (near the existing `.progress-*` rules, `:526-563`): `.modal-backdrop` (`position: fixed; inset: 0; background: rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index: 1000;`), `.modal-card` (uses `--radius-lg`, `--shadow-lg`, `--space-6`, `--mantle`, matching the existing `.card` token vocabulary), `.modal-title`, and a `.modal-spinner` with a `@keyframes spin` rotating-border spinner (reuses `--accent`/`--surface0`, matching the existing `@keyframes indeterminate` and `@keyframes pulse` authoring style at `global.css:338,559`).
3. `JobProgressView.tsx`: wrap the existing progress-bar + `.progress-log` + Cancel button (`:49-82`) inside `<Modal title={t('progress_title')} onCancel={handleCancel} cancelLabel={t('progress_btn_cancel')}>...</Modal>` instead of rendering them as a plain page body. **Drop the inner `.page-header`'s own `page-title` markup** (`:42-43`, which independently renders the same `t('progress_title')` text `Modal`'s `title` prop now owns) — only its `page-subtitle` (the done/failed/processing status line, `:44-46`) renders inside the modal as `children`, alongside the done-message block (`:56-60`). `Modal`'s `title` prop is the single place `progress_title` is rendered; nothing else duplicates it.

**Exit criteria**:
- [ ] Starting a transcription (Record or Upload) shows a centered modal with a spinner, the existing scrolling log, and a working Cancel button — not a plain full page.
- [ ] Cancel still calls `transcription:cancel-job` and returns to the prior view, unchanged from today's behavior.
- [ ] The modal backdrop visually dims whatever is behind it (there should be nothing clickable behind it in this phase, since transcription still takes over navigation — this is a visual/structural check only).

### Phase 5: Provider adapter widening — usage/duration capture [QA] [P:4]

**Goal**: Each of the four provider adapters returns its already-available billing data alongside turns, without changing turn-parsing behavior. (Foundation for Phase 7)

**Why horizontal**: Phase 7 (transcription cost tracking) needs all four adapters to expose usage data before it can be verified end-to-end across providers, and Phase 6 (pricing module) needs to be designed against the exact shape this phase produces. Building this only inside Phase 7 would make Phase 7 four times as large for no architectural reason; the four adapter files are already-independent (per `[P:N]` file-scope disjointness with Phase 4).

**File scope**: `src/main/providers/types.ts`, `src/main/providers/assemblyai.ts`, `src/main/providers/elevenlabs.ts`, `src/main/providers/openai.ts`, `src/main/providers/google.ts`, `tests/unit/providers/*.test.ts`.

**Changes**:
1. `types.ts`: add
   ```ts
   export type ProviderUsage =
     | { kind: 'duration'; seconds: number; modelUsed?: string }
     | { kind: 'tokens'; inputTokens: number; outputTokens: number; audioTokens?: number; cachedTokens?: number };
   ```
   and add `usage?: ProviderUsage` to `TranscriptChunkResult` (`:19-28`).
2. `assemblyai.ts:95-99`: widen the poll-response cast to also read `audio_duration?: number; speech_model_used?: string`. At `:110`, populate `usage: { kind: 'duration', seconds: result.audio_duration ?? 0, modelUsed: result.speech_model_used }` on the returned chunk result. Also populate `durationS` at the job level from this value (see Phase 7 — the `jobs.duration_s` incidental fix from SC-7).
3. `elevenlabs.ts:45-53`: widen the response cast to also read `audio_duration_secs?: number`. At `:98`, populate `usage: { kind: 'duration', seconds: result.audio_duration_secs ?? 0 }`.
4. `openai.ts:74-76`: widen the response cast to `{ segments?: [...]; usage?: { input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number } } }`. At `:88`, populate `usage` when `result.usage` is present: `{ kind: 'tokens', inputTokens: result.usage.input_tokens ?? 0, outputTokens: result.usage.output_tokens ?? 0, audioTokens: result.usage.input_token_details?.audio_tokens }`; if `result.usage` is absent, log a warning (`log.warn('OpenAI transcribe: no usage field in response — cost will be unknown for this call')`) and omit `usage` entirely rather than guessing zero (an absent `usage` must not silently compute as `$0`).
5. `google.ts:125`: widen the response cast to `{ steps?: Step[]; usage?: { promptTokenCount?: number; candidatesTokenCount?: number } }` (field names per Google's Interactions API reference — see the verification note below). At `:190`, populate `usage` when `result.usage` is present, following the same log-and-omit pattern as step 4 when absent.
6. **Execution-contingent verification** (do this before finalizing steps 4-5's exact field names): make one real transcription call per provider (OpenAI, Google) during implementation and inspect the raw JSON response body. If the actual field names differ from what's coded above, update the parsing to match the real shape — do not ship a guess unverified. This is the one open item carried from exploration.
7. Update `tests/unit/providers/{assemblyai,elevenlabs,openai,google}.test.ts` with synthetic response fixtures that include the new usage/duration fields, and assert the mapped `ProviderUsage` shape. Also add one test per adapter for the "usage field absent" degradation path (openai/google only, since assemblyai/elevenlabs always have `audio_duration`/`audio_duration_secs` on a completed transcript by contract).

**Exit criteria**:
- [ ] All four adapters' existing turn-parsing tests still pass unchanged (widening must not alter turn output).
- [ ] Each adapter returns a `usage` field matching its provider's real response, verified against one real (paid) call per provider during implementation.
- [ ] OpenAI/Google adapters log a warning and omit `usage` (never throw, never default to zero) when the expected field is missing from a real response.

### Phase 6: Pricing calculation module + Settings Pricing UI [QA]

**Goal**: A pure cost-calculation module plus a Settings section for user-editable per-provider rates, defaulted from today's researched values. (SC-7, rates half)

**Covers**: SC-7 (partial — rate storage and calculation; wiring into real jobs happens in Phase 7/8)

**File scope**: `src/shared/ipc-types.ts` (`PricingRates` type, `DEFAULT_PRICING_RATES` constant, `Preferences.pricingRates`), `src/main/pricing/calculate.ts` (new), `src/main/settings/store.ts`, `src/main/ipc/settings.ts`, `src/renderer/views/SettingsView.tsx`, `src/renderer/i18n.ts`, `tests/unit/pricing.test.ts` (new — `src/main/pricing/` is a genuinely new directory under `src/main/`, so a new test file is permitted per this project's Doc & Test Guidelines).

**Changes**:
1. `shared/ipc-types.ts`: add
   ```ts
   export interface PricingRates {
     assemblyai: { universal35ProPerHourUsd: number; universal2PerHourUsd: number; diarizationPerHourUsd: number };
     elevenlabs: { perHourUsd: number };
     openaiTranscribe: { inputPerMillionUsd: number; outputPerMillionUsd: number };
     openaiSummary: { inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd: number };
     google: { inputPerMillionUsd: number; outputPerMillionUsd: number };
   }
   export const DEFAULT_PRICING_RATES: PricingRates = {
     assemblyai: { universal35ProPerHourUsd: 0.21, universal2PerHourUsd: 0.15, diarizationPerHourUsd: 0.02 },
     elevenlabs: { perHourUsd: 0.22 },
     openaiTranscribe: { inputPerMillionUsd: 2.50, outputPerMillionUsd: 10.00 },
     openaiSummary: { inputPerMillionUsd: 4.00, outputPerMillionUsd: 20.00, cachedInputPerMillionUsd: 0.40 },
     google: { inputPerMillionUsd: 2.00, outputPerMillionUsd: 12.00 },
   };
   ```
   `assemblyai` carries two per-hour rates, not one — AssemblyAI's Universal-3.5-Pro and Universal-2 tiers are genuinely priced differently ($0.21/hr vs $0.15/hr per research), and `assemblyai.ts`'s own request already lists both models as acceptable (`speech_models: ['universal-3-5-pro','universal-2']`), so a fallback to the cheaper tier is a real possibility a single flat rate would mis-price. Add `pricingRates: PricingRates` to `Preferences` (`:258-265`) and `'pricingRates'` to `PreferenceKey` (`:256`). `DEFAULT_PRICING_RATES` is exported so both `store.ts`'s `DEFAULT_PREFERENCES` and `SettingsView.tsx`'s initial React state reference the same literal, never two independently-typed copies of the same numbers.
2. `store.ts:11-18`: add `pricingRates: DEFAULT_PRICING_RATES` to `DEFAULT_PREFERENCES`.
3. `ipc/settings.ts:31-39`: add a branch validating `pricingRates` — a small `isValidPricingRates(value): value is PricingRates` type guard (checking every leaf is a finite, non-negative number) rather than a one-line `typeof` check, since a malformed value here silently produces `NaN`/wrong costs rather than an obviously-rejected write. Add `'pricingRates'` to the catch-all allowlist array (`:39`).
4. New `src/main/pricing/calculate.ts`:
   ```ts
   export function calculateTranscriptionCost(provider: ProviderName, usage: ProviderUsage, rates: PricingRates): number {
     switch (provider) {
       case 'assemblyai': {
         if (usage.kind !== 'duration') return 0;
         // modelUsed selects the tier; default to the Pro rate (the first-listed,
         // primary model) when the field is absent or doesn't match a known tier.
         const perHour = usage.modelUsed?.includes('universal-2')
           ? rates.assemblyai.universal2PerHourUsd : rates.assemblyai.universal35ProPerHourUsd;
         return (usage.seconds / 3600) * (perHour + rates.assemblyai.diarizationPerHourUsd);
       }
       case 'elevenlabs':
         return usage.kind === 'duration' ? (usage.seconds / 3600) * rates.elevenlabs.perHourUsd : 0;
       case 'openai':
         // usage.audioTokens (when present) is a diagnostic breakdown of inputTokens,
         // not an additional billable quantity — OpenAI bills all input tokens for
         // this model at one uniform rate (research finding), so it is intentionally
         // not consumed here; consuming it would double-count against inputTokens.
         return usage.kind === 'tokens'
           ? (usage.inputTokens / 1e6) * rates.openaiTranscribe.inputPerMillionUsd
             + (usage.outputTokens / 1e6) * rates.openaiTranscribe.outputPerMillionUsd : 0;
       case 'google':
         return usage.kind === 'tokens'
           ? (usage.inputTokens / 1e6) * rates.google.inputPerMillionUsd
             + (usage.outputTokens / 1e6) * rates.google.outputPerMillionUsd : 0;
     }
   }

   export function calculateSummaryCost(
     usage: { inputTokens: number; outputTokens: number; cachedTokens?: number }, rates: PricingRates
   ): number {
     // Clamp defensively: cachedTokens is documented as a subset of inputTokens, but
     // a malformed/inconsistent provider response could report more cached than
     // total input tokens, which would otherwise drive the subtraction negative.
     const cached = Math.min(usage.cachedTokens ?? 0, usage.inputTokens);
     return ((usage.inputTokens - cached) / 1e6) * rates.openaiSummary.inputPerMillionUsd
          + (cached / 1e6) * rates.openaiSummary.cachedInputPerMillionUsd
          + (usage.outputTokens / 1e6) * rates.openaiSummary.outputPerMillionUsd;
   }
   ```
5. `SettingsView.tsx`: add a new "Pricing" card (following the existing `.card`/`.card-body`/`.form-group` structure used by the Export and Accessibility cards, `:192-233`) with one labeled numeric input (`type="number" min="0" step="0.01"`) per `PricingRates` leaf (now 10 fields, including AssemblyAI's two tiers), bound to a single `pricingRates` preference object (one `getPreference`/`setPreference('pricingRates', ...)` round-trip for the whole object, not per-field IPC calls).
6. New i18n keys for the Pricing card heading and each of the 10 field labels (EN + FR), including distinct labels for the AssemblyAI Universal-3.5-Pro and Universal-2 rates.

**Exit criteria**:
- [ ] Unit tests for `calculateTranscriptionCost`/`calculateSummaryCost` cover: each provider's formula against a hand-computed expected value, including AssemblyAI at **both** tiers (`modelUsed` containing `'universal-2'` vs. anything else/absent) to confirm the correct rate is selected; the cached-token discount is applied correctly in `calculateSummaryCost`; a `cachedTokens > inputTokens` input does not produce a negative cost; an `undefined` `usage.kind` mismatch (e.g. `duration` usage passed to a token-based provider) returns `0`, not `NaN` or a throw.
- [ ] Settings shows a new Pricing section pre-filled with the default rates (including both AssemblyAI tiers) on first launch; editing and saving a rate persists across an app restart.
- [ ] `isValidPricingRates` rejects a negative number or a non-numeric value written via a raw IPC call (test this directly against the handler, bypassing the UI, mirroring `settings.test.ts`'s existing validation-boundary tests).

### Phase 7: Transcription cost tracking end-to-end [QA]

**Goal**: Real, incremental cost flows from each provider call into `jobs.cost_usd` and the progress modal, and appears on HistoryView job cards. (SC-7 completion, transcription side; also fixes the dead `duration_s` display)

**Covers**: SC-7

**File scope**: `src/main/transcription/runner.ts`, `src/main/transcription/runner.ts`'s `sendProgress` payload shape (also referenced by `src/renderer/views/JobProgressView.tsx`), `src/shared/ipc-types.ts` (`transcription:progress` payload), `src/renderer/views/HistoryView.tsx`, `tests/unit/runner.test.ts`.

**Changes**:
1. `runner.ts`: read `const rates = getPreference('pricingRates')` **inside the existing `try` block** (`:74`), alongside the existing `recordingsFolder` read at `:80` — not before it. This placement is deliberate: the Risk Assessment's claim that new cost code can't extend the pre-existing `_activeJobId` stuck-forever bug is only true if every new read genuinely sits inside `try`; placing it any earlier (e.g. "near the top of `startJob()`," before `_activeJobId = jobId` at `:40` or `createJob()` at `:51`) would reopen exactly that bug via a new path.
   Inside the existing per-chunk loop (`:104-137`), immediately after the inner `for (const turn of cr.turns)` flattening block for each chunk result closes (i.e., once per `cr` in `chunkResults`, right before the loop moves to chunk `i+1`), and wrapped in its own `try/catch` isolated from the surrounding turn-processing logic:
   ```ts
   if (cr.usage) {
     try {
       const increment = calculateTranscriptionCost(provider, cr.usage, rates);
       updateJobCost(jobId, increment);
       runningCostUsd += increment;
       if (cr.usage.kind === 'duration' && durationS === undefined) {
         updateJobStatus(jobId, 'transcribing', null, cr.usage.seconds);
       }
     } catch (costError) {
       log.warn(`Job ${jobId}: cost bookkeeping failed, continuing without it: ${costError}`);
     }
   }
   sendProgress('transcribing', runningCostUsd);
   ```
   The `usage.kind === 'duration'` check (not a provider-name check) is what actually excludes OpenAI/Google from the `duration_s` incidental fix — those two always report `kind: 'tokens'`, so this guard, not any per-provider special-casing, is what prevents a multi-chunk job from repeatedly overwriting `duration_s` with a partial-chunk value. The `try/catch` around cost bookkeeping is deliberate: a `SQLITE_BUSY` or other DB error here must never discard already-fetched, already-paid-for turns or fail the whole job — cost tracking degrades independently of turn-saving. The literal status string `'transcribing'` is used because that is the job's actual status throughout this loop (set once, before the loop, at `:89`) — there is no `currentStatus` variable in the real code to reference.
2. `sendProgress` signature (`:65-70`) widens to `sendProgress(status: string, costUsd?: number)`, sending `{ jobId, status, costUsd }`. Update the `transcription:progress` push-event payload shape documented in `ipc-types.ts` (`:214-215`'s comment) accordingly — no new push channel (per Design Decisions).
3. `JobProgressView.tsx`'s progress handler (`:18-26`) destructures `{ status, costUsd }` and keeps a `costSoFar` state; renders it inside the `Modal`'s children (from Phase 4) once `costUsd !== undefined`, e.g. a line reading `~$0.02` — never rendered while `costUsd` is `undefined` (no billable unit known yet), per SC-7's "no cost shown, not `$0`" rule. On a failed/cancelled job (`status.startsWith('Error:')`/`'Cancelled'`), the last-received `costUsd` (if any) remains visible rather than being cleared — this is what "partial cost retained on failure" means concretely.
4. `HistoryView.tsx`: add a `formatCost(usd: number): string` helper (`` `$${usd.toFixed(4)}` ``, trimmed of trailing zeros) and render it in `.job-meta` (`:141-152`) after duration, following the existing `<span>·</span>` separator pattern, only when `job.cost_usd != null`.
5. `Job` type (already updated in Phase 1) flows through `db:get-job`/`db:list-jobs` automatically (direct passthrough, per Current State) — no IPC change needed beyond Phase 1's type addition.

**Exit criteria**:
- [ ] Running a real single-shot transcription (AssemblyAI or ElevenLabs) shows no cost during processing, then shows the correct cost once the job completes, matching a hand-computed value from the real response's duration, `speech_model_used` tier (AssemblyAI), and the configured rate.
- [ ] Running a real multi-chunk transcription (OpenAI or Google, an audio file long enough to produce 2+ chunks) shows the cost figure increase after each chunk completes, not only once at the end — verify the new `sendProgress('transcribing', runningCostUsd)` call fires after every chunk, not only reusing the pre-existing per-chunk-start call.
- [ ] Cancelling a multi-chunk job partway through leaves the partial cost visible in history (`jobs.cost_usd` reflects only the completed chunks).
- [ ] A job that fails before any chunk completes shows no cost anywhere (not `$0`).
- [ ] `jobs.duration_s` is populated (non-null) for a newly completed AssemblyAI/ElevenLabs job, fixing HistoryView's previously-always-blank duration display.
- [ ] A simulated `updateJobCost` failure (e.g. a mocked throw) does not fail the transcription job or lose any turns — the job still completes and saves its transcript normally.
- [ ] `npm test` passes; `runner.test.ts` covers the cost-accumulation call sequence with a mocked provider adapter returning synthetic `usage` values, including the cost-bookkeeping-failure-is-isolated case above.

### Phase 8: Summary cost, JSON persistence, re-render, and summary modal

**Goal**: Wire real summary cost; persist the compte-rendu's JSON + transcript snapshot durably; replace the session-only retry-save mechanism with a persistent "Régénérer le document" action; show the shared modal (blocking) during generation. (SC-6 completion, SC-7 completion — summary side, SC-8)

**Covers**: SC-6, SC-8

**File scope**: `src/main/summary/generate.ts`, `src/main/ipc/summary.ts`, `src/shared/ipc-types.ts` (`SummaryResult`/`SummaryStateResult`/`SummaryErrorCode`/new `summary:rerender` channel), `src/renderer/hooks/useSummary.ts`, `src/renderer/App.tsx`, `src/renderer/views/TranscriptView.tsx`, `src/renderer/i18n.ts`, `tests/unit/summary-ipc.test.ts`, `tests/unit/db.test.ts` (already touched in Phase 1 — this phase adds the `job_summaries` round-trip assertions specific to the real `summary:generate`/`summary:rerender` flow, if not already covered generically by Phase 1), `README.md`.

**Changes**:
1. `ipc/summary.ts:95`: change the call site to `await generateSummary(transcript, apiKey, durationMs, { onUsage: usage => { costUsd = parseOpenAiUsage(usage); } })`, where `parseOpenAiUsage(usage: unknown): number | undefined` reads `input_tokens`/`output_tokens`/`input_tokens_details.cached_tokens` off the value defensively and returns `calculateSummaryCost(...)`'s result **only when the shape parses successfully** — it returns `undefined` (not `0`) on a missing/malformed shape, logging a warning. `costUsd` itself is typed `number | undefined`, initialized `undefined`. **This mirrors Phase 5's own rule for the identical problem** ("an absent `usage` must not silently compute as `$0`") — the original sketch's "treat as zero-cost" behavior was inconsistent with that rule and is rejected below.
2. Immediately after `generateSummary()` returns successfully (still at `:95`, before the render/write attempt at `:100`), **wrapped in its own try/catch**:
   ```ts
   try {
     saveSummaryRecord(job.id, JSON.stringify(summary), transcript);
     if (costUsd !== undefined) updateJobCost(job.id, costUsd);
   } catch (persistError) {
     log.error(`Summary: failed to persist job_summaries record: ${persistError}`);
     // Narrow, session-only fallback for exactly this failure window: the paid
     // result is held in memory so a retry doesn't require re-billing, even
     // though it won't survive a restart the way a successful DB write would.
     pendingPersist.set(job.id, { summaryJson: JSON.stringify(summary), transcript });
     return { status: 'error', error: 'persist_failed' };
   }
   ```
   This is deliberately a *separate* try/catch from the render/write logic that follows — an uncaught throw here must never fall into the handler's existing outer catch-all, which maps unknown errors to `'provider_error'`; that would violate the code's own stated invariant ("a local failure must never be reported as a provider problem") for a failure that has nothing to do with the provider. `pendingPersist: Map<jobId, {summaryJson, transcript}>` is a new, narrowly-scoped module-level map (parallel to the removed `unsaved`, but holding the *pre-render* data so persistence itself can be retried, not a rendered buffer) — add `'persist_failed'` to `SummaryErrorCode`.
3. Remove the `unsaved: Map<jobId, Buffer>` (`:37`) and the `summary:retry-save` channel (`:120-126`) entirely. `summary:generate`'s failure branches that previously did `unsaved.set(jobId, buffer); return {..., canRetrySave:true}` (`:49-50,54,61,109`) now simply return `{status:'error', error:'save_failed'}` (etc.) with no `canRetrySave` field — since the DB record is already saved by step 2 before this point is ever reached, recovery goes through the new channel below instead.
4. New `summary:rerender` IPC channel, guarded by the same `busy` flag `summary:generate` uses (set/cleared around the whole handler body, mirroring `:71,116`) so the two channels cannot race on the same job — `rerender` opens an unbounded native save dialog, and without a shared guard a concurrent `generate` for the same job could finish and overwrite `job_summaries` before a stale `rerender` finishes writing its file:
   ```ts
   ipcMain.handle('summary:rerender', async (event, { jobId }: { jobId: string }): Promise<SummaryResult> => {
     if (busy) return { status: 'error', error: 'busy' };
     busy = true;
     try {
       const record = getSummaryRecord(jobId);
       if (!record) return { status: 'error', error: 'no_stored_summary' };
       const job = getJob(jobId);
       const summary = JSON.parse(record.summary_json) as MeetingSummary;
       let buffer: Buffer;
       try { buffer = await renderSummaryDocx(summary, record.transcript_snapshot); }
       catch (error) { log.error(`Summary: rerender failed: ${error}`); return { status: 'error', error: 'render_failed' }; }
       return save(event, jobId, job?.title ?? 'conseil-municipal', buffer); // reuses the existing save() helper, :39-67
     } finally { busy = false; }
   });
   ```
   Add `'summary:rerender'` to `IpcChannels` and `'no_stored_summary'`/`'persist_failed'` to `SummaryErrorCode` (bringing the closed union from 13 to 15 values, `shared/ipc-types.ts:46-48`).
5. `SummaryResult`/`SummaryStateResult` (`ipc-types.ts:51-55`): remove `canRetrySave`; add `hasStoredSummary: boolean` to `SummaryStateResult`, computed in the `summary:state` handler (`:130-134`) as `getSummaryRecord(jobId) !== null`.
6. `useSummary.ts`: rename `retrySave` to `rerender` (calls the new channel). Its own `SummaryState.canRetrySave` field (`:8`) is removed and replaced with `hasStoredSummary: boolean`; the two read sites that reference `canRetrySave` today — `apply()` (`:22`, reading `result.canRetrySave`) and `refresh()` (`:49`, reading `state.canRetrySave`) — are updated to read/surface `hasStoredSummary` instead. `App.tsx:77`'s `onRetrySaveSummary={() => void summary.retrySave(activeJobId)}` wiring is renamed to `onRerenderSummary={() => void summary.rerender(activeJobId)}` and threaded through to `TranscriptView` the same way.
7. `TranscriptView.tsx`: the existing "Enregistrer à un autre emplacement" retry-save button sits at `:159-160`, nested inside `{summaryError && <p role="alert">...}` (`:157-161`) — **do not simply replace it in place**, since that slot only renders during an active error and would make the new button invisible on the normal success path, contradicting SC-8. Instead, render "Régénérer le document" in its **own block**, gated solely by `summaryState.hasStoredSummary`, placed near the existing `summaryPath && <div>` success block (`:163-166`) so it is visible any time a stored record exists — independent of whether `summaryError` happens to be set. Add the summary-generation `Modal` (from Phase 4's shared component, no `onCancel`) rendered whenever `summarizing` is true, replacing the current inline `<p role="status">` — its backdrop now blocks Export/Copy/Reset/Generate **and the new Régénérer button** underneath during generation (closing SC-6's stated gap; Régénérer is rendered behind the same backdrop as the other action buttons, not exempted from it).
8. New i18n keys: `summary_btn_rerender` (`'Régénérer le document'` / `'Regenerate document'`), `summary_error_no_stored_summary`, `summary_error_persist_failed`. Remove the now-orphaned `summary_retry_save` key (EN `'Save to another location'` / FR `'Enregistrer à un autre emplacement'`, `i18n.ts:10/172`) — it was the label for the button this phase deletes.
9. `README.md:101`: rewrite the paragraph describing the old mechanism ("the rendered document is kept in memory and **Save to another location** writes it elsewhere without contacting the provider again... remembered only until the application closes") to describe the new persisted, restart-surviving "Régénérer le document"/"Regenerate document" action instead — both the button name and the durability claim change.

**Rejected**: keeping both the old Map-based retry-save and a new rerender channel side by side — see Design Decisions; two mechanisms answering the same question is exactly the kind of dangling parallel logic the Senior-engineer review persona is instructed to flag. Also rejected: defaulting `costUsd` to `0` when the summary's usage field can't be parsed (the original sketch) — this silently contradicts SC-7's "no cost, not `$0`" rule and was inconsistent with Phase 5's own opposite treatment of the identical problem.

**Exit criteria**:
- [ ] Generating a real compte-rendu persists a `job_summaries` row immediately (verifiable even if the subsequent save is cancelled/fails).
- [ ] Restarting the app after a successful generation, then clicking "Régénérer le document," produces the same document content without any new OpenAI request (verify via a network log / breakpoint that `generateSummary`/`fetch` is not called).
- [ ] "Régénérer le document" is visible and clickable immediately after a **successful** generation completes (not only when `summaryError` happens to be set) — confirms the button is not trapped inside the error-only conditional block.
- [ ] The summary-generation modal appears during generation and its backdrop prevents clicking Export/Copy/Reset/Generate/Régénérer underneath; the modal disappears on completion or error.
- [ ] A simulated `saveSummaryRecord` failure (e.g. a mocked throw) after a successful `generateSummary()` call returns `persist_failed`, not `provider_error`, and the paid result remains recoverable via `pendingPersist` for that session.
- [ ] Two concurrent `summary:rerender`/`summary:generate` calls for the same job cannot both proceed — the second one returns `{status:'error', error:'busy'}`.
- [ ] `jobs.cost_usd` increases by the real computed summary cost after a successful generation, additively on top of any existing transcription cost (confirms the "accumulate, never overwrite" semantics from Design Decisions) — and does **not** increase at all if the summary's usage field could not be parsed.
- [ ] A second, later regeneration for the same job adds a further cost increment on top (confirms cost is not silently reset when the stored JSON is replaced).
- [ ] `tests/unit/summary-ipc.test.ts` is updated: all `summary:retry-save`-specific tests are replaced with `summary:rerender` equivalents; `canRetrySave` assertions are removed; new tests cover the "no stored record" (`no_stored_summary`) path, the persist-before-render ordering (a render failure after a successful `generateSummary()` call still leaves a `job_summaries` row), the `persist_failed` path, and the `busy`-guard race between `generate`/`rerender`.
- [ ] `useSummary.ts`'s `apply()`/`refresh()` no longer reference `canRetrySave` anywhere; `App.tsx`'s prop wiring is renamed accordingly.
- [ ] `README.md:101` no longer describes the session-only retry-save mechanism; it describes the persisted Régénérer action instead.
- [ ] `npm test` passes.

## 6) Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| DB migration corrupts or loses data in the user's live `db.sqlite` | High — irreplaceable personal meeting data | `MIGRATION_002` runs inside a transaction, with `PRAGMA user_version = 2` as the transaction's own last statement so the schema change and version bump commit atomically (a separate post-transaction version write would let a crash between the two cause a permanent re-run failure — see Design Decisions); an automatic backup is taken only when upgrading an existing install (not on a fresh install), preceded by `PRAGMA wal_checkpoint(TRUNCATE)` so the copy isn't missing recent WAL-only commits; Phase 1 adds an explicit restore-from-backup dry-run exit criterion (Phase 1) |
| OpenAI `gpt-4o-transcribe-diarize` or Google Gemini `usage` field shape differs from what's coded | Medium — cost silently missing (not wrong) for that provider | Phase 5 mandates a real-call verification before shipping; both adapters log-and-omit rather than guess or crash on an unexpected shape |
| A DB write for cost/duration bookkeeping fails mid-job (e.g. `SQLITE_BUSY`) | High if unmitigated — would discard already-fetched, already-paid-for transcript turns and fail the whole job over a secondary concern | Cost/duration writes inside the transcription loop are wrapped in their own try/catch that logs and continues, decoupled from turn-saving (Phase 7) |
| `saveSummaryRecord` throws right after a successful, paid `generateSummary()` call | High if unmitigated — with `unsaved` removed, the paid result would become unrecoverable with no trace, and an uncaught throw would be misreported as `provider_error` | Wrapped in its own try/catch, returns a distinct `persist_failed` code, and a narrow session-only `pendingPersist` fallback holds the pre-render data for this exact window (Phase 8) |
| `summary:rerender` races a concurrent `summary:generate` for the same job | Medium — a stale rerender could overwrite a fresher generation's saved file | `summary:rerender` now shares the same `busy` guard `summary:generate` uses (Phase 8) |
| Pricing rates go stale (OpenAI's `gpt-5.6-sol` promotional rate expires 2026-11-21; other providers' pages already ~4 months old) | Medium — displayed cost silently diverges from real invoices over time | Settings-editable rates (Q3); tracked as a Follow-up Work item to revisit after 2026-11-21 |
| AssemblyAI's actually-used model tier (Universal-3.5-Pro vs. Universal-2) isn't reflected in cost if `speech_model_used` is absent from a real response | Medium — wrong tier's rate applied | `calculateTranscriptionCost` defaults to the Pro (primary, first-listed) tier when `modelUsed` is absent or unrecognized; Phase 5's real-call verification confirms the field's actual presence (Phase 5, 6) |
| ElevenLabs' undocumented billing rounding rule | Low — small, unquantifiable rounding difference vs. the real invoice | Accepted; no further mitigation available from the app side |
| Universal PAYG-tier assumption (no API can detect free-tier/negotiated pricing) | Low, given user confirmed standard PAYG on all four accounts today | No app-side mitigation possible; documented as a known limitation |
| Removing `summary:retry-save`/`unsaved` Map changes existing IPC surface and tests | Medium — a missed call site would silently break the old retry flow | `tests/unit/summary-ipc.test.ts` is explicitly updated in Phase 8; all three real renderer-side call sites (`useSummary.ts`, `App.tsx`, `TranscriptView.tsx` — corrected from an earlier undercount that named only one) are updated in Phase 8; a repo-wide grep for `retry-save`/`canRetrySave`/`retrySave` is part of Phase 8's review to catch any remaining reference |
| Pre-existing `_activeJobId` stuck-forever bug (`runner.ts`, `createJob()` can throw before the `try` block) | Medium if triggered, but pre-existing and out of scope | Not fixed by this plan (see Scope boundaries); the new `pricingRates` read is explicitly placed *inside* the existing `try` block (Phase 7, corrected from an earlier draft that risked placing it before the block), so it does not introduce new ways to trigger this bug |
| New Settings Pricing UI accepts garbage input (negative/NaN rates) | Low — would silently show wrong costs | `isValidPricingRates` type guard at the IPC boundary (Phase 6); `<input type="number" min="0">` in the UI as a first line of defense |

## 7) Verification

- `npm test` from repo root after every phase (never raw `vitest`, per this project's `AGENTS.md`).
- Manual E2E via `npm run dev`, requiring real configured API keys for at least one transcription provider and OpenAI; small real charges are expected and consistent with existing project practice.
- DB migration verified against a **copy** of the real `userData/db.sqlite`, never the live file directly, until Phase 1 is fully confirmed safe.
- Each phase annotated `[QA]` gets a light `/qqa` pass; Phase 8 (not `[QA]`-annotated, since its summary-generation modal and rerender flow depend on Phase 4's and Phase 6's completed work) is covered by `/qdev`'s exhaustive Step 9b QA instead.

## 8) Documentation Updates

| Document | Update needed | Phase |
|---|---|---|
| `README.md` | Line 72: `"**Export ⇩** saves the transcript to a `.txt` file."` becomes false the moment Phase 3 ships `.docx` export — rewrite to describe `.docx` output. | 3 |
| `README.md` | Line 75: the sentence introducing the transcript line-format (`` `[HH:MM:SS] Speaker Name: text` ``) currently reads as describing a `.txt` file's contents — reword so it describes the paragraph content of the generated Word document instead (the format itself is unchanged, per SC-3). | 3 |
| `README.md` | Line 101: the paragraph describing the session-only retry-save mechanism ("kept in memory... **Save to another location**... remembered only until the application closes") is a direct, currently-true description of exactly what Phase 8 deletes — rewrite to describe the persisted, restart-surviving "Régénérer le document"/"Regenerate document" action instead. This is the largest documentation gap this plan touches. | 8 |
| `plans/260916_TRANSCRIPT_EDIT_TIMESTAMP_FONTSIZE.md`, `plans/260916_ASSEMBLYAI_SPEAKER_COUNT_HINT.md` | None — these are pending-archival historical implementation records (same nature as `plans/done/`, just not yet moved there by `/qclose`), not living specs; editing another plan's historical record to reflect a later plan is not standard practice. | doc-table-only |

**Correction to this plan's own earlier self-check**: an initial pass (performed inline by the plan author rather than via a dispatched sub-agent, as this project's governance actually requires at every tier) wrongly declared `README.md` a false-positive. A properly dispatched doc-impact sub-agent re-checked the actual README text directly and found the three real hits above — two in the export section (Phase 3), one describing the exact retry-save mechanism Phase 8 removes (Phase 8), the most significant of the three. The sub-agent's full search covered five categories (code identifiers, runtime constants, operational identifiers, architectural concepts, plan/phase identifiers) against every living document in the repo (`README.md`, `AGENTS.md`, and the two non-archived plan files above — no `docs/` directory or other documentation format exists). No other hit across any category required a documentation update; `AGENTS.md` contains only Doc & Test Guidelines / test-execution policy and needs no edit itself (its own rule is what makes the README updates above required, not optional). A minor, non-blocking observation from the same sweep: two plans marked "implementation complete" (`260916_TRANSCRIPT_EDIT_TIMESTAMP_FONTSIZE.md`, `260916_ASSEMBLYAI_SPEAKER_COUNT_HINT.md`) remain un-archived at `plans/` root rather than `plans/done/` — a `/qclose` housekeeping item, unrelated to this plan's own documentation impact, noted here only because it surfaced during the sweep.

## 9) Implementation Divergences from Plan

### Phase 1

1. **Migration backup gate signal**: the plan's literal pseudocode (Changes item 2) gated the pre-migration backup on `PRAGMA user_version === 1`. As implemented, the gate uses `dbAlreadyExisted = fs.existsSync(dbPath)`, checked before the database file is opened. `user_version` reads `0` for both a brand-new file and every database that predates this versioning scheme — including the app's real, populated production `db.sqlite` — so the literal plan gate would have silently skipped the backup on exactly the transition it exists to protect. Confirmed correct both by code review (two personas) and by the unplanned incident below, whose backup was created correctly under the corrected logic. Phase 1's Changes section and the "Migration backup completeness" Design Decision row have been updated in place to describe the implemented signal.
2. **`createJob` parameter type**: narrowed from `Job` to `Omit<Job, 'cost_usd'>`. Adding `cost_usd` to the `Job` interface (plan Changes item 3) broke `tsc --noEmit` at `runner.ts:51` (a call site outside Phase 1's file scope) because a job never carries a cost at creation — it is only ever set via the new, accumulating `updateJobCost()`. Confirmed the only call sites (`runner.ts:51`, `ipc/db.ts`) never supply `cost_usd`, and confirmed this is more consistent with the rest of `Job`'s nullable-but-required-field style than making the field optional would have been.
3. **Unplanned real-data incident**: a stray, imperfectly-terminated `npm run dev` process from earlier orchestrator QA-tooling testing auto-restarted mid-implementation and ran the new migration against the live production `db.sqlite`, ahead of the planned copy-based verification. Outcome (independently re-verified read-only by the orchestrator): clean migration, correct backup, all pre-existing data intact. Not a code defect; recorded as a Harness Improvement Opportunity below. This incident is also what surfaced the concurrency-hazard review finding that led to the `busy_timeout` fix and the single-instance-lock follow-up.
4. **Single-instance lock added to `src/main/index.ts`**: outside Phase 1's declared file scope, but a direct, user-approved response to a review finding (see Review Log) — a review-driven follow-up fix, not a new plan phase.

## Progress Tracker

| # | Phase/Task | Status | Notes |
|---|---|---|---|
| 1 | DB migration runner + schema | Done | Foundation for 7, 8. Code: d130e6a, 97bd9dd, 53d8ad2. |
| 2 | Default page + font-size default | Not started | |
| 3 | TranscriptView button revamp | Not started | |
| 4 | Shared Modal + transcription restyle | Not started | [P] with 5 |
| 5 | Provider adapter widening | Not started | [P] with 4 |
| 6 | Pricing module + Settings UI | Not started | Depends on 5's usage shape |
| 7 | Transcription cost tracking | Not started | Depends on 1, 4, 5, 6 |
| 8 | Summary cost + persistence + rerender + modal | Not started | Depends on 1, 4, 6 |

## Dependency Graph

```
Phase 1 (DB migration) ──────────────┬──────────────────────┐
                                      │                      │
Phase 4 (Modal) ──[P]── Phase 5 (adapters)                   │
      │                      │                               │
      │                      ▼                               │
      │                Phase 6 (pricing module + Settings)   │
      │                      │                               │
      ▼                      ▼                               ▼
      └──────────────► Phase 7 (transcription cost) ◄────────┘
                              
Phase 4 ──────────────────────────────────────► Phase 8 (summary cost + persistence + rerender)
Phase 1 ──────────────────────────────────────► Phase 8
Phase 6 ──────────────────────────────────────► Phase 8

Phase 2, Phase 3: independent of the above, no ordering constraint (may run any time)
```

## Backwards Compatibility

| Item | Strategy | Safety effect |
|---|---|---|
| Existing jobs pre-migration have `cost_usd = NULL` | HistoryView renders nothing (not `$0`) when `cost_usd == null` — same treatment already used for jobs that fail before any billable unit is known | No misleading `$0.00` ever shown for data that predates this feature |
| `summary:retry-save` channel removed | Only internal renderer code calls it — `useSummary.ts` (the `retrySave` function), `App.tsx` (the `onRetrySaveSummary` prop wiring), and `TranscriptView.tsx` (the button that invokes it); no external consumers exist (single-process Electron app, no public API) | Safe to remove outright; all three call sites are updated in Phase 8, verified by a repo-wide grep |
| `.txt` export removed in favor of `.docx` | The `export:to-file` channel name and request/response shape are unchanged — only the file format changes | No IPC-level breaking change; any external script invoking the app's IPC (none known to exist) would only see a different file extension |
| `SummaryResult`/`SummaryStateResult` lose `canRetrySave`, gain `hasStoredSummary` | Both types are internal to this single-process app (declared in `shared/ipc-types.ts`, consumed only by `useSummary.ts` and `TranscriptView.tsx`) | No external consumer; verified by the same Phase 8 grep |

## File Change Summary

### Created
- `src/main/db/migrations/002_add_cost_and_summaries.sql`
- `src/main/db/summaries.ts`
- `src/main/pricing/calculate.ts`
- `src/renderer/components/Modal.tsx`
- `src/main/export/transcript-docx.ts`
- `tests/unit/pricing.test.ts`
- `tests/unit/export/transcript-docx.test.ts`

### Modified
- `src/main/db/index.ts`, `src/main/db/jobs.ts`
- `src/shared/ipc-types.ts`
- `src/renderer/App.tsx`, `src/renderer/i18n.ts`, `src/renderer/components/Sidebar.tsx` (no functional change, but shares the `View` type touched conceptually — verify no edit actually needed there per SC-1's scope)
- `src/main/settings/store.ts`, `src/main/ipc/settings.ts`, `src/renderer/views/SettingsView.tsx`
- `src/renderer/views/TranscriptView.tsx`, `src/main/ipc/export.ts`
- `src/renderer/views/JobProgressView.tsx`, `src/renderer/styles/global.css`
- `src/main/providers/types.ts`, `src/main/providers/{assemblyai,elevenlabs,openai,google}.ts`
- `src/main/transcription/runner.ts`, `src/renderer/views/HistoryView.tsx`
- `src/main/summary/generate.ts`, `src/main/ipc/summary.ts`, `src/renderer/hooks/useSummary.ts`
- `tests/unit/db.test.ts`, `tests/unit/summary-ipc.test.ts`, `tests/unit/runner.test.ts`, `tests/unit/providers/*.test.ts`
- `README.md` (lines 72, 75, 101 — see Documentation Updates)

### Deleted
- None (the `unsaved` Map and `summary:retry-save` handler are removed as code within `ipc/summary.ts`, not a file deletion; a new, narrower `pendingPersist` map replaces `unsaved` for a different, smaller purpose — see Phase 8)

### Unchanged
- `src/preload/index.ts`, `src/renderer/global.d.ts` (no new push channel; existing `invoke`/`on`/`off` plumbing is generic enough for every new channel/field added here)
- `src/main/summary/render-docx.ts`, `src/main/summary/schema.ts`, `src/main/summary/prompt.ts`, `src/main/summary/transcript.ts` (the summary-rendering/validation logic itself is untouched — only its persistence and cost-wiring around it changes)

## Follow-up Work (Deferred)

1. **Re-verify OpenAI's `gpt-5.6-sol` pricing after 2026-11-21.** The current $4/$20 (short-context) rate is explicitly promotional per OpenAI's own pricing page; no reversion price is published. Source: Risk Assessment row 3.
2. **Revisit ElevenLabs cost precision if it proves materially wrong.** ElevenLabs does not publicly document its billing rounding rule; the app's computed figure may be a small, currently-unquantifiable amount off from the real invoice. Source: Risk Assessment row 4.
3. **Consider fixing the pre-existing `_activeJobId` stuck-forever bug** (`runner.ts`, `createJob()` can throw before the `try` block) as a separate, focused bugfix — explicitly out of scope for this plan. Source: Scope boundaries & non-goals.
4. **`db/jobs.ts`'s `getJob()` has the same `undefined`-vs-`null` cast bug** the Phase 1 diff fixed in its sibling `getSummaryRecord()` (better-sqlite3's `.get()` returns `undefined` on no match; `getJob` casts straight to `Job | null` with no `?? null`). Confirmed latent (all 5 call sites use truthiness, none do strict `=== null`), not currently failing, and out of Phase 1's scope since the function wasn't touched by that diff. Source: Phase 1 review, Senior engineer, finding #7.

## Review Log

### 2026-09-18 — Plan Review (via /qplan, 1 cycle per explicit user instruction)

5 sub-agents dispatched in parallel: a doc-impact sweep, plus 4 review personas (Architect with gap-critic lens, Senior engineer, Domain expert on billing correctness, Reliability engineer on migration/failure modes) against the Correctness/Completeness/Feasibility/Risk/External-readiness/Cost-impact standards subset. 22 distinct findings after deduplication across personas (8 High, 7 Medium, 7 Low), plus one doc-impact correction to this plan's own earlier self-check. All auto-fixed directly in this pass — no findings required escalation to the user, since each was either a concrete implementation-correctness gap with one clear fix, or (for the two genuine external-fact questions Domain expert raised) resolvable from research already gathered earlier in this project's `/qexplore` phase. Per the explicit "1 qreview cycle only" instruction, this is the single review pass — no re-dispatch to verify the fixes.

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | High | Régénérer button was specified to replace code nested inside an error-only conditional block, so SC-8 would ship invisible on the normal success path. | Fixed — moved to its own block gated solely by `hasStoredSummary` (Phase 8). |
| 2 | High | The migration backup (`fs.copyFileSync`) doesn't account for WAL mode; recent commits in `-wal` could be silently missing from the safety copy. | Fixed — added `PRAGMA wal_checkpoint(TRUNCATE)` before the copy (Phase 1). |
| 3 | High | `MIGRATION_002`'s `ALTER TABLE` and the `user_version` bump were two separate, non-atomic steps; a crash between them would permanently break every future launch. | Fixed — the version bump is now the last statement inside `MIGRATION_002`'s own transacted SQL (Phase 1). |
| 4 | High | Cost/duration DB writes inside the transcription loop had no isolating try/catch, risking a whole-job failure (and lost paid turns) from a secondary DB error. | Fixed — wrapped in their own try/catch that logs and continues (Phase 7). |
| 5 | High | Phase 8's summary persistence had no try/catch; an uncaught throw after a paid call would be misreported as `provider_error` with the result unrecoverable. | Fixed — wrapped in its own try/catch, returns `persist_failed`, adds a narrow `pendingPersist` fallback (Phase 8). |
| 6 | High | `calculateTranscriptionCost`'s OpenAI branch captured `usage.audioTokens` but never used it, looking like a dropped billing input. | Fixed — documented as diagnostic-only (OpenAI bills all input tokens uniformly per research); formula unchanged (Phase 6). |
| 7 | High | AssemblyAI's `modelUsed` was captured but never used, despite Universal-3.5-Pro/Universal-2 being priced differently ($0.21 vs $0.15/hr). | Fixed — `PricingRates.assemblyai` now carries both tiers, selected by `modelUsed` (Phase 6). |
| 8 | High | Phase 8's `parseOpenAiUsage` defaulted to a `$0` cost increment on missing/malformed usage, contradicting SC-7's "no cost, not $0" rule. | Fixed — now skips `updateJobCost` entirely when usage can't be parsed, mirroring Phase 5's rule (Phase 8). |
| 9 | Medium | `useSummary.ts`'s own `SummaryState.canRetrySave` field and its two read sites weren't in Phase 8's change list. | Fixed — explicit step added replacing it with `hasStoredSummary` at both read sites (Phase 8). |
| 10 | Medium | Modal nesting would duplicate the progress-view heading (Modal's own title plus the existing page-header). | Fixed — the inner page-title is explicitly dropped when moved inside Modal (Phase 4). |
| 11 | Medium | No exit criterion validated the migration backup is actually restorable. | Fixed — added a restore-from-backup dry-run exit criterion (Phase 1). |
| 12 | Medium | Backwards Compatibility table undercounted `summary:retry-save` call sites (named only `useSummary.ts`). | Fixed — corrected to name all three real call sites. |
| 13 | Medium | Phase 7's pseudocode referenced a nonexistent `currentStatus` variable and didn't show the concrete `sendProgress` call site, risking a lost multi-chunk progressive reveal. | Fixed — replaced with the literal `'transcribing'` status and an explicit call site (Phase 7). |
| 14 | Medium | Reading `pricingRates` "near the top of `startJob()`" risked sitting before the `try` block, contradicting the Risk Assessment's own claim and extending the pre-existing `_activeJobId` bug's trigger surface. | Fixed — explicitly placed inside the `try` block (Phase 7). |
| 15 | Medium | `summary:rerender` had no guard against racing a concurrent `summary:generate` for the same job. | Fixed — now shares the `busy` flag (Phase 8). |
| 16 | Low | `calculateSummaryCost` had no clamp for `cachedTokens > inputTokens`, which could drive cost negative. | Fixed — added a `Math.min` clamp (Phase 6). |
| 17 | Low | The `duration_s` guard's stated rationale ("single-shot provider") didn't match its actual mechanism (`usage.kind === 'duration'`). | Fixed — rationale now states the real discriminant (Phase 7). |
| 18 | Low | The orphaned `summary_retry_save` i18n key would be left behind after the button using it is deleted. | Fixed — added to Phase 8's removal list. |
| 19 | Low | The migration backup ran unconditionally, including on fresh installs with no real data to protect. | Fixed — now only taken when `version === 1` (upgrading an existing install), not on a fresh install. |
| 20 | Low | A new `tests/unit/export.test.ts` was justified via a self-invented governance exception not in `AGENTS.md`'s actual carve-out (new directory/module only). | Fixed — the new renderer relocated to a genuinely new `src/main/export/` directory, making the new test file legitimate under the existing carve-out (Phase 3). |
| 21 | Low | The new transcript-docx renderer was placed inside `src/main/summary/`, blurring the export/summary module boundary. | Fixed — relocated to `src/main/export/transcript-docx.ts` (Phase 3; same fix as #20). |
| 22 | Low | Régénérer's coverage by the generation-modal backdrop wasn't explicitly stated. | Fixed — Phase 8 now states explicitly that Régénérer renders behind the same backdrop as the other action buttons. |
| 23 | (doc-impact correction) | This plan's own inline self-check wrongly declared `README.md` a false-positive; three real hits exist (lines 72, 75, 101), including a significant rewrite of the retry-save description. | Fixed — Documentation Updates section (§8) rewritten with the real findings, wired into Phase 3 and Phase 8 exit criteria. |

No unresolved High or Medium findings remain. Two Domain-expert open questions (whether OpenAI's audio tokens are separately priced; whether AssemblyAI's two tiers are genuinely priced differently) were resolved from this project's own earlier `/qexplore` research rather than left open — both are cited inline in the Design Decisions table entries added above.

### 2026-09-18 -- Implementation Review (after Phase 1, persona: Reliability engineer, Senior engineer)

Implementation health: Green (no unresolved High or Medium findings after the auto-fix pass).
9 findings after merge (0 High, 3 Medium, 6 Low), per the explicit "1 qreview cycle per phase" instruction: reviewed once, auto-fixed once, no cycle-2 re-review of the fixes.

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | Medium | The new migration path (backup + `MIGRATION_002`) had no try/catch/logging, unlike `MIGRATION_001` immediately above it — a failure would crash uncaught with nothing in electron-log. | Fixed — wrapped in try/catch mirroring `MIGRATION_001`'s pattern, with best-effort cleanup of a partial backup on failure (97bd9dd). |
| 2 | Medium | `initDb()`'s real migration-gating/backup logic — this phase's core deliverable — had zero automated test coverage; `db.test.ts` mocks `initDb` to a no-op. | Fixed — added real, unmocked `initDb()` tests via `vi.importActual` covering fresh-install, upgrade, and restart paths (97bd9dd). |
| 3 | Medium | No guard against two Electron instances racing `initDb()` concurrently — the exact precondition of the unplanned incident (see Implementation Divergences), via a different cause. | Fixed — narrow: `busy_timeout=5000` + WAL-checkpoint busy-flag logging (97bd9dd). Broader: `app.requestSingleInstanceLock()` added to `src/main/index.ts`, user-approved live during this review. |
| 4 | Low | `db:create-job` IPC channel's request type didn't also omit `cost_usd`, unlike `createJob`'s own updated signature (dead channel, no real call site). | Fixed — added `cost_usd` to the same `Omit` (97bd9dd). |
| 5 | Low | Vestigial `if (version < 1) _db.pragma('user_version = 1')` write had zero effect on final state — always overwritten by `MIGRATION_002`'s own trailing version bump in the same call. | Fixed — removed (97bd9dd). |
| 6 | Low | The only real-world evidence Phase 1's migration path works end-to-end was the unplanned incident, which ran against the live file, not a copy as EC2 literally specifies. | Fixed — clarified: the implementer's actual EC2 verification script was already copy-based (seeded from the incident's genuine pre-migration backup, per its own report); the live run was a separate, unintended event, not the recorded verification method. |
| 7 | Low | Pre-existing `db/jobs.ts`'s `getJob()` has the same `undefined`-vs-`null` cast bug this diff's sibling `getSummaryRecord()` fixes with `?? null` — confirmed via all 5 call sites (none do strict `=== null`, so latent, not currently failing). | Out of Phase 1's scope (function not touched by this diff) — reported to the user, not fixed here; candidate for a small standalone follow-up. |
| 8 | Low | Plan's own literal pseudocode/Design Decision text for the backup gate still described the superseded `PRAGMA user_version`-based signal, not the implemented `dbAlreadyExisted` check. | Fixed — Phase 1 Changes section and the "Migration backup completeness" Design Decision row updated in place. |
| 9 | Low | Progress Tracker row 1 still read "Not started" despite all 6 exit criteria ticked. | Fixed — updated to "Done". |

Two divergences from the plan's literal text (backup-gate signal, `createJob` parameter narrowing — see Implementation Divergences) were verified sound by both review personas independently before being accepted as-is. No override-discipline violations found in the plan's existing Review Log.

## Harness Improvement Opportunities

- User invoked `/qdev` with "1 qreview cycle per phase" — overrides `/qdev` Step 6's default (dispatch review, classify findings, auto-fix, then a mandatory cycle-2 re-review before commit, up to 2 cycles). Applied override: dispatch review once per phase, classify auto-fix vs. escalate, apply auto-fixes via re-spawn, log `Fixed —` in the review log, and stop — no cycle-2 re-review verifying the fixes landed cleanly. Cost of the override: auto-fixes are unverified by a second review pass (a fix could itself introduce a regression that ships uncaught until Step 9's holistic review). Step 8 auto-continue gating is unaffected. — cost: per-phase fixes go unverified by a second review pass until Step 9's holistic review — suggested change: consider a lighter "cycle-2 diff-only" check (re-review only the fix's diff, not the whole phase) as a middle ground between 1 and 2 full cycles.
- This project's `#1 Non-goals` bullet assumed the new `Modal` component would be "verified through /qdev's browser-driven QA step... consistent with how existing renderer views are verified" — but this is an Electron app, and claude-in-chrome only drives Chrome browser tabs, not Electron `BrowserWindow`s, so that assumption was untested at plan-writing time. Discovered and resolved during `/qdev` Step 1: `vite-plugin-electron`'s dev-mode `startup()` helper already honors a `REMOTE_DEBUGGING_PORT` env var and forwards it to Electron as `--remote-debugging-port`, exposing the live renderer over the Chrome DevTools Protocol; a small dependency-free Node script (Node 24 ships a global `WebSocket` client) drives it directly via `Runtime.evaluate`, without Playwright/Puppeteer and without any code or config change to the app itself. — cost: ~20 minutes of investigation before Phase 1 could start (would recur on every Electron-app plan without this note) — suggested change: record "Electron app + no code-review-only QA fallback wanted" as a documented pattern (e.g. a topic memory or a `/qqa` note) pointing at the `REMOTE_DEBUGGING_PORT` + raw-CDP-`Runtime.evaluate` technique, so future Electron plans don't re-derive it from scratch.
- Editing `src/main/**` while a `npm run dev` instance is running against this project executes new main-process code (including DB migrations) against the live userData database via Vite's main-process auto-restart, with no warning — the orchestrator's own imperfectly-terminated background dev instance auto-restarted mid-Phase-1-implementation and ran a real, untested migration against production data (harmless here because the migration was additive and self-backing-up, but would not be in general). — cost: an unauthorized live migration ran mid-task, requiring an out-of-band read-only re-verification of real user data to confirm no harm — suggested change: before an orchestrator starts a background `npm run dev` (or similar file-watching dev server) for an Electron/main-process app, confirm no prior instance survived a previous stop, and confirm it's fully stopped (not just its shell wrapper) before dispatching implementation sub-agents that touch `src/main/**`.
