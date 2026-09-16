# AssemblyAI Speaker-Count Hint

> **Date**: 2026-09-16
> **Status**: Draft  <!-- Status grammar: shared/skills/qplan/TEMPLATES.md § Status Grammar -->
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
- SC-3: Input is validated client-side against an arbitrary sanity bound (positive integers, 1–20, and `min ≤ max` in range mode) — out-of-range or non-integer input blocks submission with an error, before the job can be submitted.
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

## Context

AssemblyAI's diarization mis-attributes speakers when it has to guess the participant count. AssemblyAI's API accepts an optional, mutually-exclusive speaker-count hint — either `speakers_expected` (exact integer) or `speaker_options` (a `min_speakers_expected`/`max_speakers_expected` range) — confirmed via AssemblyAI's API reference (assemblyai.com/docs/api-reference/transcripts/submit). Neither OpenAI, Google, nor ElevenLabs has an equivalent hint (OpenAI's closest feature, `known_speaker_names[]`/`known_speaker_references[]`, is a materially different voice-sample-identification mechanism capped at 4 speakers), so this plan is AssemblyAI-only.

The value is entered per-job in RecordView/UploadView, shown only when the app's default provider is AssemblyAI — this avoids repeating the dead-UI mistake already present for `TranscriptionOptions.prompt`, which is fully wired into `assemblyai.ts` but has zero UI/IPC surface anywhere in the app. The value is never persisted (no DB column, no preference) — it's used only at request-build time for that job, exactly like the existing `diarize` flag (`runner.ts:110` hardcodes `diarize: true`, never persisted).

**Design decisions**:
- **Data shape**: a discriminated union `SpeakerCountHint = { mode: 'exact'; count: number } | { mode: 'range'; min: number; max: number }`, defined in `src/shared/ipc-types.ts` (shared between renderer and main, following the precedent of `ProviderName`/`TranscriptTurn` already being imported into `src/main/*` from there) and imported by `src/main/providers/types.ts`. A union naturally enforces AssemblyAI's own mutual-exclusivity constraint rather than two independent optional fields that could both be set by mistake.
- **Bounds**: reject values outside an arbitrary, reasonable client-side sanity bound of 1–20 for both modes — this is NOT AssemblyAI's own documented limit for either field (AssemblyAI's API reference states `speakers_expected` must be a positive integer with no stated maximum, and `max_speakers_expected`'s default varies by audio duration: no limit for 0-2min, 10 for 2-10min, 30 for 10+min; confirmed via assemblyai.com/docs/api-reference/transcripts/submit, 2026-09-16). A live AssemblyAI acceptance or rejection either way is non-blocking, surfaced via the provider's existing HTTP-error passthrough at `assemblyai.ts`'s `createResp.ok` check — the Verification section's live-job test is the actual confirmation mechanism, not this client-side bound.

**Risk note (renderer-wiring coverage gap)**: this plan's own automated tests (SC-6) cover only the main-process half of the data-flow chain (`TranscriptionOptions` → AssemblyAI request body, `StartJobOptions` → `TranscriptionOptions`) — the same layer where `prompt` (see above) was fully exercised yet still went dead, because the failure mode lives one layer further out, at the renderer. This repo has no renderer/component test harness (no `@testing-library/react`/jsdom rendering tests; all `tests/unit/*` are Node-level), and adding one would conflict with this project's `AGENTS.md § Doc & Test Guidelines` ("do not introduce new test files unless required"). So whether `RecordView.tsx`/`UploadView.tsx` actually include `speakerCountHint` in the `transcription:start-job` payload is covered ONLY by the manual QA checklist in Verification — treat those checks as mandatory acceptance criteria, not optional, before considering this plan done.

**Note on citations below**: this file's own line-number citations into `ipc-types.ts` were already found stale once during planning (a sibling in-flight plan, `260916_TRANSCRIPT_EDIT_TIMESTAMP_FONTSIZE`, shifted the `transcription:start-job` block from lines 169-180 to 178-189 before this plan was even written). Citations below are anchored primarily by key/variable name, with line numbers as a secondary, re-verify-at-implementation-time aid only.

## Files to modify

| File | Change |
|---|---|
| `src/shared/ipc-types.ts` | Add `SpeakerCountHint` type; add `speakerCountHint?: SpeakerCountHint` to `IpcChannels['transcription:start-job']['request']` (anchored by the `'transcription:start-job':` key string; verified at lines 178-189 on 2026-09-16) |
| `src/main/providers/types.ts` | Import `SpeakerCountHint` from `../../shared/ipc-types`; add `speakerCountHint?: SpeakerCountHint` to `TranscriptionOptions` |
| `src/main/providers/assemblyai.ts` | In the `transcriptBody` construction (anchored by that variable name, currently lines 43-55), add a conditional spread sending `speakers_expected` (exact mode) or `speaker_options: { min_speakers_expected, max_speakers_expected }` (range mode) — never both |
| `src/main/transcription/runner.ts` | Import `SpeakerCountHint`; add `speakerCountHint?: SpeakerCountHint` to `StartJobOptions` (interface, currently lines 22-30); add to the destructure (currently lines 35-37); add to the per-chunk options literal (anchored by the `diarize: true` literal, currently line 110) |
| `src/renderer/views/RecordView.tsx` | Add `import type { SpeakerCountHint } from '../../shared/ipc-types';`; add local state + a mode toggle (none/exact/range) rendered only when `selectedProvider === 'assemblyai'`; validate **before** `await stop()` (see Step 5 ordering note) and include `speakerCountHint` in the `transcription:start-job` invoke call inside `handleStop` (currently lines 83-90) |
| `src/renderer/views/UploadView.tsx` | Add `import type { SpeakerCountHint } from '../../shared/ipc-types';`; same UI/validation pattern as RecordView, for `handleTranscribe` (currently lines 99-106) — no destructive pre-step here, unlike RecordView |
| `src/main/ipc/transcription.ts` | No change needed — `opts` in the `ipcMain.handle('transcription:start-job', ...)` handler is implicitly `any` and forwarded wholesale to `runner.startJob(opts)` (line 38), so `speakerCountHint` passes through untyped/unchecked automatically |
| `src/renderer/i18n.ts` | Add 9 new flat keys to both `en` and `fr` |
| `tests/unit/providers/assemblyai.test.ts` | Add 3 test cases: exact mode sends `speakers_expected`, range mode sends `speaker_options`, unset mode sends neither |
| `tests/unit/runner.test.ts` | Extend the existing `startJob({...})` fixtures (currently lines 68-76, 108-116) to assert `speakerCountHint` reaches the options object passed to `transcribeFile` |
| `README.md` | Add one line each to the "Record a meeting" (lines 44-50) and "Upload an existing recording" (lines 52-57) steps noting the optional speaker-count control, gated on AssemblyAI being the active provider |

## External Dependencies

None. This uses AssemblyAI's existing `/v2/transcript` endpoint with two additional optional request-body keys already documented in AssemblyAI's public API reference — no new service, credential, or infrastructure change, no cost impact.

## Rollout / Migration / Cleanup

None. No persisted data changes, no schema migration, no manual operator steps. The feature is additive and defaults to off (unset hint), so existing behavior is unchanged for anyone who doesn't set it.

## Step-by-step

### 1. Add the shared `SpeakerCountHint` type and thread it through the IPC contract

In `src/shared/ipc-types.ts`, add near the other shared type declarations (close to `SpeakerMapping`):

```ts
export type SpeakerCountHint =
  | { mode: 'exact'; count: number }
  | { mode: 'range'; min: number; max: number };
```

In the `'transcription:start-job'` request shape (locate by the key string, not the line number):

```ts
'transcription:start-job': {
  request: {
    jobId: string;
    title: string;
    audioPath: string;
    provider: ProviderName;
    model: string;
    language: 'fr' | 'en' | 'auto';
    durationS?: number;
    speakerCountHint?: SpeakerCountHint;   // new
  };
  response: void;
};
```

### 2. Add the field to `TranscriptionOptions`

In `src/main/providers/types.ts`:

```ts
import type { SpeakerCountHint } from '../../shared/ipc-types';

export interface TranscriptionOptions {
  language: 'fr' | 'en' | 'auto';
  diarize: boolean;
  prompt?: string;
  speakerCountHint?: SpeakerCountHint;   // new — currently read only by assemblyai.ts
}
```

### 3. Wire it through `StartJobOptions` and the runner

In `src/main/transcription/runner.ts`:

- Extend the existing `import type { ProviderName, TranscriptTurn } from '../../shared/ipc-types';` line to also import `SpeakerCountHint`.
- Add `speakerCountHint?: SpeakerCountHint;` to the `StartJobOptions` interface.
- Add `speakerCountHint` to the destructure: `const { jobId, title, audioPath, provider, model, language, durationS, speakerCountHint } = opts;`
- Update the per-chunk options literal (inside the `for (let i = 0; ...)` loop, anchored by the `diarize: true` literal):

```ts
const chunkResults = await providerAdapter.transcribeFile(
  chunkPath,
  { language, diarize: true, speakerCountHint },
  (s) => sendProgress(`Chunk ${i + 1}: ${s}`),
  signal
);
```

### 4. Send the hint in the AssemblyAI request body

In `src/main/providers/assemblyai.ts`, extend the `transcriptBody` object:

```ts
const transcriptBody: Record<string, unknown> = {
  audio_url: upload_url,
  speech_models: ['universal-3-5-pro', 'universal-2'],
  speaker_labels: options.diarize,
  language_code: options.language === 'auto' ? undefined : options.language,
  language_detection: options.language === 'auto',
  ...(options.prompt != null && options.prompt.trim() !== '' ? { prompt: options.prompt } : {}),
  ...(options.speakerCountHint?.mode === 'exact'
    ? { speakers_expected: options.speakerCountHint.count }
    : options.speakerCountHint?.mode === 'range'
    ? {
        speaker_options: {
          min_speakers_expected: options.speakerCountHint.min,
          max_speakers_expected: options.speakerCountHint.max,
        },
      }
    : {}),
};
```

### 5. Add the UI control to RecordView and UploadView (identical pattern in both, with one ordering exception in RecordView — see below)

Add the import needed by the state/helper code below to both files:

```ts
import type { SpeakerCountHint } from '../../shared/ipc-types';
```

Add local state near the other `useState` declarations:

```tsx
const [speakerMode, setSpeakerMode] = useState<'none' | 'exact' | 'range'>('none');
const [speakerExact, setSpeakerExact] = useState('');
const [speakerMin, setSpeakerMin] = useState('');
const [speakerMax, setSpeakerMax] = useState('');
```

Add a validation/build helper inline in the component (matching this codebase's existing pattern of small per-component helpers rather than a shared utils module — there is no shared test harness for renderer utilities that would justify extracting one, and this project's `AGENTS.md § Doc & Test Guidelines` says not to introduce new test files unless required):

```tsx
function buildSpeakerCountHint(): { hint: SpeakerCountHint | undefined; error: string | null } {
  if (speakerMode === 'none') return { hint: undefined, error: null };
  if (speakerMode === 'exact') {
    const count = Number(speakerExact);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return { hint: undefined, error: t('speaker_count_error_exact') };
    }
    return { hint: { mode: 'exact', count }, error: null };
  }
  const min = Number(speakerMin);
  const max = Number(speakerMax);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 20 || min > max) {
    return { hint: undefined, error: t('speaker_count_error_range') };
  }
  return { hint: { mode: 'range', min, max }, error: null };
}
```

Call it before invoking `transcription:start-job`, blocking submission on error:

```tsx
const { hint, error: hintError } = buildSpeakerCountHint();
if (hintError) { setError(hintError); return; }
// ...
await window.electronAPI.invoke('transcription:start-job', {
  // ...existing fields...
  speakerCountHint: hint,
});
```

**RecordView-specific ordering (not symmetric with UploadView)**: RecordView's `handleStop` currently calls `await stop()` (RecordView.tsx:78) before invoking `transcription:start-job` — `stop()` disconnects the mic, finalizes the audio file, and resets `status`/`currentJobId` (see `useRecorder.ts`'s `stop()`), so it is destructive and not re-runnable. Call `buildSpeakerCountHint()` and check its error **before** `await stop()`, not merely before the IPC invoke call — otherwise an invalid speaker-count entry tears down the recording session with no job created and no in-app retry path, leaving the audio file orphaned on disk. UploadView has no equivalent destructive pre-step, so this ordering constraint applies to RecordView only.

Render the control conditionally, only when `selectedProvider === 'assemblyai'`:

```tsx
{selectedProvider === 'assemblyai' && (
  <div className="form-group">
    <label className="form-label">{t('speaker_count_label')}</label>
    <select
      className="form-select"
      value={speakerMode}
      onChange={e => setSpeakerMode(e.target.value as 'none' | 'exact' | 'range')}
      disabled={!isIdle}
    >
      <option value="none">{t('speaker_count_mode_none')}</option>
      <option value="exact">{t('speaker_count_mode_exact')}</option>
      <option value="range">{t('speaker_count_mode_range')}</option>
    </select>
    {speakerMode === 'exact' && (
      <input
        className="form-input" type="number" min={1} max={20}
        value={speakerExact} onChange={e => setSpeakerExact(e.target.value)}
        placeholder={t('speaker_count_exact_placeholder')}
      />
    )}
    {speakerMode === 'range' && (
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="form-input" type="number" min={1} max={20} value={speakerMin} onChange={e => setSpeakerMin(e.target.value)} placeholder={t('speaker_count_min_placeholder')} />
        <input className="form-input" type="number" min={1} max={20} value={speakerMax} onChange={e => setSpeakerMax(e.target.value)} placeholder={t('speaker_count_max_placeholder')} />
      </div>
    )}
  </div>
)}
```

`disabled={!isIdle}` matches RecordView's existing language selector; UploadView has no `isIdle` concept, so omit that prop there, matching UploadView's own language `<select>`.

### 6. Add i18n keys

In `src/renderer/i18n.ts`, add to both `en` and `fr`:

| Key | en | fr |
|---|---|---|
| `speaker_count_label` | Number of speakers (optional) | Nombre d'intervenants (optionnel) |
| `speaker_count_mode_none` | Let AssemblyAI detect automatically | Détection automatique par AssemblyAI |
| `speaker_count_mode_exact` | Exact count | Nombre exact |
| `speaker_count_mode_range` | Range (min–max) | Plage (min–max) |
| `speaker_count_exact_placeholder` | e.g. 4 | ex. 4 |
| `speaker_count_min_placeholder` | Min | Min |
| `speaker_count_max_placeholder` | Max | Max |
| `speaker_count_error_exact` | Enter a whole number of speakers between 1 and 20. | Entrez un nombre entier d'intervenants entre 1 et 20. |
| `speaker_count_error_range` | Enter whole numbers between 1 and 20, with min ≤ max. | Entrez des nombres entiers entre 1 et 20, avec min ≤ max. |

### 7. Update tests

`tests/unit/providers/assemblyai.test.ts` — add cases asserting the actual request body (the second `fetch` mock call, matching this file's existing mocking pattern):
- `speakerCountHint: { mode: 'exact', count: 4 }` → body contains `speakers_expected: 4`, no `speaker_options` key.
- `speakerCountHint: { mode: 'range', min: 2, max: 6 }` → body contains `speaker_options: { min_speakers_expected: 2, max_speakers_expected: 6 }`, no `speakers_expected` key.
- `speakerCountHint` unset (today's default) → body contains neither key (regression guard for the "dead field" risk below).

`tests/unit/runner.test.ts` — extend the existing `startJob({...})` fixtures to pass a `speakerCountHint` and assert the mocked `transcribeFile` receives it in its options argument.

### 8. Update README.md

In the `## Usage` section:
- "Record a meeting": add a step noting the optional speaker-count control, shown when AssemblyAI is the active provider.
- "Upload an existing recording": same addition.

## Verification

- `npm test` — must stay green (baseline: 78/78 passing across 10 files, confirmed 2026-09-16); expect a higher total after the new assemblyai.ts and runner.ts assertions.
- **Manual QA (mandatory, not optional — see Context's renderer-wiring coverage-gap note: these checks are the only coverage for whether the renderer actually wires `speakerCountHint` into the IPC payload)**, in dev mode (Electron + Vite dev server on `localhost:5173`, per `src/main/index.ts:24-27` — confirm the exact `npm` dev script name in `package.json` at implementation time; not independently confirmed this session):
  - With default provider set to AssemblyAI (Settings): confirm the speaker-count control appears in both RecordView and UploadView.
  - Switch default provider to any other provider: confirm the control disappears from both views.
  - Exact mode: enter values outside 1–20, or non-integers — confirm the validation error blocks submission.
  - Range mode: enter min > max — confirm the validation error blocks submission.
  - With a configured AssemblyAI API key, run one real job in each mode (exact, range, unset) and confirm the job completes without an HTTP error — this closes the "does the 1–20 bound apply identically to `speaker_options`" open item carried from exploration.

## Documentation updates

- `README.md` — add the two usage-step lines described in Step 8 (required per this project's `AGENTS.md § Doc & Test Guidelines`: "Update README.md ... when changes affect ... basic usage").
- No `AGENTS.md` change needed (confirmed via doc-impact sub-agent search — no AssemblyAI/diarization-specific content exists there to update).

## Harness Improvement Opportunities

None observed during `/qexplore` or `/qplan` for this project.

## Review Log

### 2026-09-16 — Plan Review (via /qplan, Senior engineer persona)

7 findings (0 High, 4 Medium, 3 Low). 7 auto-resolved.

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | Medium | Step 5's snippet uses `SpeakerCountHint` in RecordView/UploadView without an import instruction; confirmed `tsc --strict` fails as written. | Fixed — added explicit `import type { SpeakerCountHint }` instruction to Step 5 and the Files-to-modify table. |
| 2 | Medium | RecordView's `handleStop` calls destructive `await stop()` before the IPC invoke; validating only "before invoking transcription:start-job" risks tearing down the recording on an invalid input with no retry path. | Fixed — Step 5 now states validation must run before `await stop()` in RecordView specifically, noting the asymmetry with UploadView. |
| 3 | Medium | Context stated the 1–20 bound as AssemblyAI's own documented cap; two live fetches of AssemblyAI's API reference show no such flat limit exists for either field. | Fixed — reworded to an explicit client-side sanity bound, not a confirmed AssemblyAI limit, matching the hedge already used for range mode. |
| 4 | Medium | SC-6's automated tests only cover the main-process half of the chain, leaving the renderer-wiring layer (the exact layer where `prompt` went dead) covered only by optional-reading manual QA. | Fixed — added a Context risk note and marked the Verification manual QA checklist as mandatory. |
| 5 | Low | Files-to-modify table omits `src/main/ipc/transcription.ts`, a real hop in the data-flow chain. | Fixed — added a row noting no change is needed there and why. |
| 6 | Low | SC-3 said input is "clamped" to 1–20; Step 5's actual code rejects out-of-range input with a blocking error rather than coercing it. | Fixed — reworded SC-3 to match the actual reject-on-invalid behavior. |
| 7 | Low | A single shared error string shows an irrelevant "(min ≤ max for a range)" clause in exact mode. | Fixed — split into `speaker_count_error_exact` and `speaker_count_error_range` i18n keys. |
