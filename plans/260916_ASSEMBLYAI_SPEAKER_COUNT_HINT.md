# AssemblyAI Speaker-Count Hint

> **Date**: 2026-09-16
> **Status**: Exploring  <!-- Status grammar: shared/skills/qplan/TEMPLATES.md § Status Grammar -->
> **Last Updated**: <set by /qclose at archival>
> **Scope**: Add a per-job speaker-count hint (exact or min/max range) to AssemblyAI transcription requests, surfaced in RecordView/UploadView only when AssemblyAI is the active provider.

---

## Intent

### Problem statement & desired outcomes

The user's first diarized transcription had multiple speakers wrongly identified. The app is mainly used with AssemblyAI. AssemblyAI's diarization has to guess the number of distinct speakers when it isn't told, and a wrong guess is what causes merge/split errors (two people collapsed into one label, or one person split across two). The app currently never sends any speaker-count hint — `src/main/providers/assemblyai.ts:43-55` sends `speaker_labels: options.diarize` but no `speakers_expected` or `speaker_options`.

Desired outcome: when the user knows (or can bound) how many people were in a meeting, they can supply that as a hint before starting a recording or upload, and it flows through to the AssemblyAI request, improving speaker attribution accuracy for AssemblyAI jobs specifically.

### Success criteria

- SC-1: When the app's default provider is AssemblyAI, RecordView and UploadView show a speaker-count control offering two modes — "exact count" (one number input) and "min/max range" (two number inputs) — selected via a toggle, defaulting to unset (no hint, today's behavior).
- SC-2: The chosen value flows through IPC → `StartJobOptions` → `TranscriptionOptions` → the AssemblyAI request body as `speakers_expected` (exact mode) or `speaker_options: { min_speakers_expected, max_speakers_expected }` (range mode) — the two are mutually exclusive per AssemblyAI's API, so the request must send exactly one, never both.
- SC-3: Input is validated client-side: positive integers, clamped to 1–20, and `min ≤ max` in range mode, before the job can be submitted.
- SC-4: When the configured default provider is NOT AssemblyAI, the speaker-count control does not render.
- SC-5: The value is NOT persisted — no `jobs` table column, no new preference key. It is used only at request-build time for that job, mirroring how `diarize` already works today.
- SC-6: `tests/unit/providers/assemblyai.test.ts` asserts the actual request body contains the correct `speakers_expected` or `speaker_options` key depending on mode. `tests/unit/runner.test.ts` is updated if the options-literal shape at `runner.ts:110` changes.
- SC-7: New UI strings are added to both `en` and `fr` in `src/renderer/i18n.ts`.
- SC-8: `npm test` passes (baseline: 78/78 tests, 10 files, confirmed 2026-09-16).

### Scope boundaries & non-goals

**In scope:** AssemblyAI provider only.

**Out of scope:**
- OpenAI's `known_speaker_names[]`/`known_speaker_references[]` feature — a materially different mechanism (voice-sample-based identification of up to 4 named speakers via 2–10s reference clips, not a count hint). Noted as a separate future idea, not built here.
- Analogous hints for Google Gemini 3.5 Transcribe or ElevenLabs Scribe v2 — neither has a documented user-facing speaker-count parameter (Google: fully automatic diarization, capped at 8, 3+ experimental; ElevenLabs: only a max-speaker cap, no hint parameter found).
- Persisting the chosen value (DB column or preference).
- Any change to the existing manual speaker-relabeling UI (`SpeakerLabel.tsx`) — it remains a working, complementary, untouched mechanism.

---

<!-- Transient: /qplan folds these into the planning sections and removes this section. -->
## Exploration Discovery

### Existing patterns & constraints

- `TranscriptionOptions` (`src/main/providers/types.ts:1-6`) is shared across all four providers. Only AssemblyAI will read the new field(s); the other three adapters are safe to ignore them — confirmed none of them spread the full `options` object (openai.ts reads only `options.diarize`; google.ts reads only `options.language`; elevenlabs.ts reads `options.diarize`/`options.language`).
- **Dead-field precedent to avoid repeating**: `TranscriptionOptions.prompt` (`types.ts:5`) is fully read at `assemblyai.ts:54` but is permanently `undefined` in production — the only `TranscriptionOptions` object-literal construction site anywhere in the repo is `runner.ts:110`: `{ language, diarize: true }`, which never sets `.prompt`. The same "declared but never wired" shape applies to `StartJobOptions.model` (sent as a throwaway literal from `RecordView.tsx:88`/`UploadView.tsx:104`, persisted to `jobs.model`, but read by no provider). The new field(s) must be deliberately threaded through every hop below, not just added to a type.
- **Full hop chain** a new field must cross (confirmed by the mutation-trace sub-agent): renderer state (`RecordView.tsx`/`UploadView.tsx`, two independent object literals) → `transcription:start-job` IPC call → `IpcChannels['transcription:start-job']['request']` (`src/shared/ipc-types.ts:169-180` — convention only, **not compiler-enforced**: `src/preload/index.ts:12-14` types `invoke`'s args as `unknown[]`, and there are two independent, inconsistent `Window.electronAPI` `declare global` blocks at `useSettings.ts:5-9` and `useRecorder.ts:18-20+`) → `src/main/ipc/transcription.ts:9-39` handler (validates only `audioPath`; the rest of `opts` passes through untyped) → `StartJobOptions` (`runner.ts:22-30` — must add the field to both the interface and the destructure at lines 35-37) → the `{ language, diarize: true }` literal at `runner.ts:110` (inside the per-chunk loop starting line 103) → `TranscriptionOptions` (`types.ts:1-6`) → `assemblyai.ts`'s `transcriptBody` (lines 43-55 — follow the existing conditional-spread pattern used for `prompt` at line 54).
- No schema-validation library exists in the project (`package.json` has no zod/joi/yup/ajv) — nothing enforces request shape at any hop beyond manual review and tests.
- AssemblyAI is always single-chunk (`NO_CHUNK_PROVIDERS` in `src/main/chunker/index.ts:41`) — `chunk_index` is always 0, no `Chunk N – ` label prefixing applies. No chunk-boundary complication for this feature.
- `defaultProvider` preference is already loaded into renderer state in both `RecordView.tsx` (`selectedProvider`) and `UploadView.tsx` (`selectedProvider`) via `getPreference('defaultProvider')` — conditionally rendering the new field on `selectedProvider === 'assemblyai'` requires no new plumbing.
- i18n completeness (`en`/`fr`) is enforced only by TypeScript's structural typing (`i18n.ts:1`, `I18nKey = keyof typeof en`; `fr: Record<I18nKey, string>`), checked via `tsc --noEmit` in the `build` script — not by any test.
- No DB migration framework exists (`src/main/db/index.ts` runs one idempotent `CREATE TABLE IF NOT EXISTS` script, no `ALTER TABLE` history) — moot for this feature since the value isn't persisted, but relevant if scope ever grows.
- Manual speaker-relabeling UI (`SpeakerLabel.tsx`, `useTranscript.ts`) is a fully-working, separate mechanism — renames raw speaker labels post-hoc but cannot fix a wrong speaker *count*. Confirmed complementary, not competing; left untouched.
- AssemblyAI request-building already uses a `Record<string, unknown>` with conditional spreads for optional fields (`assemblyai.ts:43-55`) — the new field(s) should follow that exact pattern.

### Risks & mitigations

- **Risk**: the field gets added to `TranscriptionOptions`/`ipc-types.ts` but a renderer call site is forgotten (repeating the `prompt`/`model` dead-field pattern), and nothing in the compiler or existing tests would catch it. **Mitigation**: `/qplan` should make "assert on the actual request body in `assemblyai.test.ts`" and "assert both `RecordView` and `UploadView` include the field in their `transcription:start-job` call" explicit per-phase exit criteria, not just "add tests."
- **Risk**: the assumed 1–20 bound (documented for `speakers_expected`) may not apply identically to `speaker_options`'s min/max — unverified for range mode. **Mitigation**: apply the same clamp to both as a starting point; if AssemblyAI rejects an in-range value, it surfaces via the existing HTTP-error passthrough (`assemblyai.ts` already throws `AssemblyAI create transcript failed: HTTP ${status}` on non-OK responses) — non-blocking.
- **Risk (pre-existing, out of scope)**: two independent, inconsistent `Window.electronAPI` `declare global` blocks mean IPC payload typing is weak project-wide. Not this feature's job to fix; flagged for awareness.

### Resolved decisions

- Q1: Should the speaker-count hint apply only to AssemblyAI, or also to OpenAI/Google/ElevenLabs? — A: initially "all 4 providers"; revised after research showed none of the other three have an equivalent parameter (OpenAI has a different known-speaker-references feature; Google/ElevenLabs have no user-facing count hint) — A (final): AssemblyAI only. — Decision: scope is AssemblyAI-only; OpenAI's known-speaker-references feature is noted as a separate future idea, not built here.
- Q2: Exact count vs. min/max range vs. both? — A: both, with a mode toggle. — Decision: implement both `speakers_expected` (exact) and `speaker_options.{min,max}_speakers_expected` (range) modes, mutually exclusive per AssemblyAI's documented API constraint (assemblyai.com/docs/api-reference/transcripts/submit) — the request body sends exactly one, never both.
- Q3: UI placement and persistence? — A: per-job field, not persisted. — Decision: field lives in RecordView/UploadView only; no DB column, no preference; used only at request-build time.
- Q4: Field visibility when the default provider isn't AssemblyAI? — A: show only when default provider is AssemblyAI. — Decision: conditionally render based on the already-loaded `selectedProvider`/`defaultProvider` state.

### Open items

- Whether AssemblyAI's 1–20 speaker cap (documented for `speakers_expected`) applies identically to `speaker_options`'s min/max bounds — deterministic, resolvable by re-checking AssemblyAI's API reference or by live testing; `/qplan`/`/qdev` can resolve without blocking on the user.
- Whether the two inconsistent `Window.electronAPI` type declarations should be consolidated — pre-existing repo issue, out of scope for this feature; noted for a possible separate follow-up.

### Assumptions (unconfirmed at individual-question level; reviewed and accepted by the user in chat on 2026-09-16)

- UI widget shape: exact mode = one number input; range mode = two number inputs (min/max), switched by a toggle — standard pattern matching existing `form-group`/`form-select` styling in RecordView/UploadView.
- Bounds: clamp input to 1–20 for both modes (extending AssemblyAI's documented `speakers_expected` cap to `speaker_options` for consistency — not independently confirmed for range mode; see Open Items).
- Default state: field starts unset — no hint sent unless the user opts in.
- Client-side validation: positive integers, `min ≤ max` in range mode, enforced before submission, to avoid a wasted round trip against AssemblyAI's own validation.
- i18n: new strings added to both `en` and `fr`, flat-key convention (e.g. `record_speaker_count_label`), no interpolation needed.
- Testing: new assertion in `assemblyai.test.ts` inspecting the request body for `speakers_expected`/`speaker_options`; `runner.test.ts` updated if the options-literal shape changes. No new UI component test — this repo has no component test harness (`transcript-view.test.ts` re-implements logic inline rather than mounting components).

### Recommended approach

Add optional fields (e.g. `speakersExpected?: number` and `speakerOptions?: { min?: number; max?: number }`) threaded through the full hop chain identified above: renderer state → IPC request → `StartJobOptions` → the `runner.ts:110` options literal → `TranscriptionOptions` → `assemblyai.ts`'s conditional-spread request body. Add the toggle control to RecordView and UploadView, gated on `selectedProvider === 'assemblyai'`. Add i18n keys to both languages. Update the two test files per SC-6.

### QA environment

- `npm test` — `vitest run` (rebuilds `better-sqlite3` first per this project's `AGENTS.md`). Baseline confirmed 2026-09-16: 78/78 tests passing across 10 files.
- No component test harness exists for the renderer — RecordView/UploadView changes need manual verification by running the app in dev mode (Electron loads `http://localhost:5173` when `NODE_ENV=development`, per `src/main/index.ts:24-27`, backed by a Vite dev server). The exact `npm` script name for starting dev mode was not independently confirmed this session — `/qplan`/`/qdev` should check `package.json`.
- Manual verification should cover: field renders only when default provider is AssemblyAI (toggle the Settings provider to confirm both show/hide states); exact-mode and range-mode inputs validate bounds and `min ≤ max`; a real AssemblyAI job (requires a configured API key) confirms the request succeeds with either mode set.
