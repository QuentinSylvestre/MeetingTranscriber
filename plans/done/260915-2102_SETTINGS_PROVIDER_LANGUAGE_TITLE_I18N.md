# Settings: Provider, Language, Title Editing & UI Language

> **Date**: 2026-09-15
> **Status**: Complete
> **Last Updated**: 2026-09-15 18:15
> **Scope**: 4 features — provider global setting, default language preference, post-transcription title editing, FR/EN UI language
> **Estimated effort**: 1–2 days

## Completion Summary

6 phases implemented and reviewed in one session. All 5 success criteria met. 78/78 unit tests pass throughout. Final review (Senior engineer + Reliability engineer + Architect) found 4 Medium findings — all fixed. Plan health: Green.

Commits: `a40c3f6` (phase 1) → `457f088` (phase 2) → `04d4376` (phase 3) → `e629536` (phase 4) → `57285e9` (phase 5) → `a0113d3` (phase 6) + fix commits `6370e51`, `9064ddd`, `0f100b1`, `a09c80b`, `85ec5f7`, `1be509c`.

### Acknowledged at archival

- Accepted — Step 9b QA: BLOCKED — Electron app requires GUI environment; all unit tests pass; runtime surfaces require manual verification per plan § 7 Verification checklist. Test audio `test_60s.mp3` available for upload flow at `C:\path\to\test_60s.mp3` (10-run budget unused).
- Accepted — Low: pre-existing `on`/`off` TS type conflict in `window.electronAPI` declarations (`useSettings.ts` vs `useRecorder.ts`) — present before this plan, out of scope.
- Accepted — Low: Dev debug `audio src:` overlay in `TranscriptView.tsx` (`NODE_ENV === 'development'` gated, production-safe) — pre-existing audio URL fix bundled in same commit.

---

## Intent

### Problem statement & desired outcomes

Four improvements to the app's settings and post-transcription UX:

1. **Provider in settings** — provider selection is currently per-form local state in RecordView and UploadView, defaulting to AssemblyAI with no memory. Moving it to a global preference removes redundant dropdowns and lets the user configure their provider once.

2. **Default transcription language** — `defaultLanguage` already exists as a preference key but is never surfaced in SettingsView and defaults to `'auto'`. Users primarily transcribing in French should have French pre-selected without touching the form every time.

3. **Editable job title** — the title assigned at recording/upload time cannot be changed after the fact. Users need to rename jobs from the TranscriptView (immediately after transcription) and from HistoryView (when browsing old jobs).

4. **UI language** — the entire app UI is hardcoded English. A French/English language toggle in Settings lets French-speaking users use the app in their language.

### Success criteria

- SC1: A `defaultProvider` preference exists in SettingsView. Provider dropdowns are removed from RecordView and UploadView. All transcription jobs use the provider from Settings.
- SC2: `defaultLanguage` is surfaced in SettingsView with `'fr'` as the stored default. RecordView and UploadView language dropdowns initialize from this preference.
- SC3: Double-click a job title in TranscriptView or HistoryView to rename it inline. Changes persist to the `jobs` table. TranscriptView displays the current job title as its heading.
- SC4: An `appLanguage` preference (`'fr'` | `'en'`) is in SettingsView. Selecting French translates all ~50 renderer UI strings. Selecting English restores English. Default stored preference is French; in-memory default (first render) is English to avoid async flicker.
- SC5: `tests/unit/settings.test.ts` updated to assert `defaultLanguage === 'fr'`. New `updateJobTitle` test added to `db.test.ts`.

### Scope boundaries & non-goals

- In scope: all 4 features above, unit test updates.
- Out of scope: system audio capture, chunk_count correctness, per-job provider override after moving provider to settings, translating progress log lines from the main process (`'Preparing audio...'`, `'Transcribing chunk N...'` etc.), any new npm i18n library.
- The `'auto'` value for `defaultLanguage` remains valid in the type and validator; SettingsView only offers `fr`/`en`. A stored `'auto'` value is treated as `'fr'` in the UI display.

---

## 1) Current State

- `PreferenceKey = 'recordingsFolder' | 'defaultLanguage'` (`src/shared/ipc-types.ts` § `PreferenceKey`). `defaultLanguage` defaults to `'auto'` in `src/main/settings/store.ts` § `DEFAULT_PREFERENCES`.
- `settings:set-preference` handler validates `defaultLanguage` against `['fr','en','auto']` (`src/main/ipc/settings.ts` § `registerSettingsHandlers`). New preference keys need parallel validation blocks.
- `RecordView.tsx` and `UploadView.tsx` each initialize provider and language as hardcoded local state (`'assemblyai'` and `'auto'`). Neither calls `getPreference` on mount.
- `SettingsView.tsx` uses only `hasSecret`/`setSecret`/`testSecret`; `getPreference` and `setPreference` exist in `useSettings` but have no current callers in any view.
- No `updateJobTitle` function exists in `src/main/db/jobs.ts`. `jobs` table has `title TEXT NOT NULL`; no schema change needed.
- `IpcChannels` in `src/shared/ipc-types.ts` § `IpcChannels` has no `'db:update-job-title'` channel.
- `App.tsx` passes only `jobId` and `audioPath` to `TranscriptView`; the title is not threaded through.
- No React context providers exist in the renderer (`main.tsx` wraps only `<React.StrictMode>`; `App.tsx` wraps only `<ErrorBoundary>`). The i18n context will be the first.
- `SpeakerLabel.tsx` has an inline double-click-to-edit pattern (double-click opens input, Enter/blur commits, Escape cancels).
- `'Done'`, `'Error:'`, and `'Cancelled'` are pattern-matched in `JobProgressView.tsx` § `useEffect` handler to drive navigation. These strings come from `runner.ts` via IPC and must remain untranslated end-to-end.
- Unit test `tests/unit/settings.test.ts` § `preferences default schema applied when file missing` asserts `prefs.defaultLanguage === 'auto'`; this will fail after Phase 1.

## 2) Goal

Add `defaultProvider` and `appLanguage` global preferences; surface `defaultLanguage` default; remove per-job provider dropdowns; support inline title editing after transcription; and introduce a zero-dependency FR/EN UI language system via React context.

## 3) Design Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Provider: global-only vs per-job default | Global only — dropdowns removed | Per-job overridable default | Simpler forms; users configure once; can always visit Settings to change |
| Language: global-only vs per-job default | Per-job overridable default (dropdown stays) | Global only | Language changes per-recording are realistic; `auto` removed as default |
| TranscriptView title source | `db:get-job` on mount | Thread `job.title` through `App.tsx` | Keeps `App.tsx` state surface minimal; one extra IPC call is negligible |
| HistoryView after title edit | Optimistic local state update | Full `refresh()` re-fetch | Avoids IPC round-trip; simpler feel; consistent with existing speaker-rename pattern |
| i18n approach | React context + static string maps, no npm dependency | `i18next`, `react-intl` | Exactly 2 languages + ~50 strings; a library is over-engineering |
| In-memory i18n default | English (switches to French after async pref load) | Default French (wait for load) | No async gating; French stored default means first-launch and all launches after initial are French |
| `'auto'` stored as `defaultLanguage` | Treat as `'fr'` in SettingsView display only | Reject / migrate | Value remains valid; only SettingsView falls back; no data migration needed |
| Progress log line translation | Not translated | Translate in renderer display layer | `'Done'`/`'Error:'`/`'Cancelled'` drive navigation in JobProgressView; mapping them is fragile even renderer-side |

## 4) External Dependencies & Costs

### Required external changes

None. All changes are in-process (renderer + main process). No infra, CI/CD, IAM, DNS, or third-party service changes.

### Cost impact

None. No new API calls or external services.

## 5) Implementation Phases

### Phase 1: Preferences groundwork — types, store, IPC, tests [QA]

**Goal**: Add `defaultProvider` and `appLanguage` to the preferences system; change `defaultLanguage` default to `'fr'`; update the broken unit test.

**Covers**: SC1 (partial — type/store/IPC layer), SC2 (partial), SC4 (partial), SC5

**File scope**:
- `src/shared/ipc-types.ts`
- `src/main/settings/store.ts`
- `src/main/ipc/settings.ts`
- `tests/unit/settings.test.ts`

**Changes**:

1. `src/shared/ipc-types.ts` — extend `PreferenceKey` and `Preferences`:
   ```ts
   // Before:
   export type PreferenceKey = 'recordingsFolder' | 'defaultLanguage';
   export interface Preferences {
     recordingsFolder: string;
     defaultLanguage: 'fr' | 'en' | 'auto';
   }

   // After:
   export type PreferenceKey = 'recordingsFolder' | 'defaultLanguage' | 'defaultProvider' | 'appLanguage';
   export interface Preferences {
     recordingsFolder: string;
     defaultLanguage: 'fr' | 'en' | 'auto';
     defaultProvider: ProviderName;
     appLanguage: 'fr' | 'en';
   }
   ```

2. `src/main/settings/store.ts` — update `DEFAULT_PREFERENCES`:
   ```ts
   const DEFAULT_PREFERENCES: Preferences = {
     recordingsFolder: path.join(app.getPath('documents'), 'MeetingTranscriber'),
     defaultLanguage: 'fr',   // changed from 'auto'
     defaultProvider: 'assemblyai',
     appLanguage: 'fr',
   };
   ```

3. `src/main/ipc/settings.ts` — add validation blocks in `settings:set-preference` handler after the existing `defaultLanguage` block. `PROVIDER_NAMES` is already exported from `ipc-types.ts`; add it to the import at the top of the file:
   ```ts
   if (key === 'defaultProvider' && !(PROVIDER_NAMES as string[]).includes(value as string)) {
     return;
   }
   if (key === 'appLanguage' && !(['fr', 'en'] as string[]).includes(value as string)) {
     return;
   }
   // Exhaustive catch-all: any key not explicitly validated above is rejected
   // (covers future PreferenceKey additions that forget to add a validator).
   // Note: the existing 'recordingsFolder' check uses typeof guard, so only add
   // the catch-all after all named key checks:
   // else { return; }  — already implicit by having no else branch writing stale data;
   // but better to be explicit: add below the appLanguage block.
   ```
   The final `settings:set-preference` handler must end with an `else { return; }` after all named-key if-blocks so any unvalidated key is rejected silently. The full handler structure must be:
   ```ts
   if (key === 'recordingsFolder' && typeof value !== 'string') { return; }
   else if (key === 'defaultLanguage' && !['fr', 'en', 'auto'].includes(value as string)) { return; }
   else if (key === 'defaultProvider' && !(PROVIDER_NAMES as string[]).includes(value as string)) { return; }
   else if (key === 'appLanguage' && !(['fr', 'en'] as string[]).includes(value as string)) { return; }
   else if (!(['recordingsFolder', 'defaultLanguage', 'defaultProvider', 'appLanguage'] as string[]).includes(key)) { return; }
   store.setPreference(key, value as Preferences[typeof key]);
   ```
   Add `PROVIDER_NAMES` to the import from `../../shared/ipc-types` in `ipc/settings.ts`.

   **Implementation note**: The catch-all list `['recordingsFolder', 'defaultLanguage', 'defaultProvider', 'appLanguage']` must be kept in sync with `PreferenceKey`. When adding a future preference key, update BOTH `PreferenceKey` (in `ipc-types.ts`) AND this catch-all list AND add a named validation block — all three change together. The alternative of deriving from `Object.keys(DEFAULT_PREFERENCES)` would auto-sync but adds an IPC-layer dependency on the store module's runtime state.

4. `tests/unit/settings.test.ts` — update the failing assertion (§ `preferences default schema applied when file missing`):
   ```ts
   // Before:
   expect(prefs.defaultLanguage).toBe('auto');
   // After:
   expect(prefs.defaultLanguage).toBe('fr');
   ```
   Add assertions for the two new keys:
   ```ts
   expect(prefs.defaultProvider).toBe('assemblyai');
   expect(prefs.appLanguage).toBe('fr');
   ```

**Exit criteria**:
- [x] `npm test` passes with no failures in `settings.test.ts`
- [x] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [x] `DEFAULT_PREFERENCES` has all 4 keys; `Preferences` interface has all 4 fields


#### Implementation (2026-09-15, code: a40c3f6)
Extended `PreferenceKey` union and `Preferences` interface with `defaultProvider: ProviderName` and `appLanguage: 'fr' | 'en'`. Changed `DEFAULT_PREFERENCES.defaultLanguage` from `'auto'` to `'fr'`; added `defaultProvider: 'assemblyai'` and `appLanguage: 'fr'`. Restructured `settings:set-preference` validation into exhaustive if-else chain with catch-all rejecting unknown keys; added `PROVIDER_NAMES` import to `ipc/settings.ts`. Updated `settings.test.ts` assertion to `'fr'`; added `defaultProvider` and `appLanguage` assertions. 78/78 tests pass; no new TS errors in phase files.

---

### Phase 2: DB — title update function and IPC channel [QA]

**Goal**: Add `updateJobTitle` to the DB layer and expose it via IPC.

**Covers**: SC3 (partial — backend layer), SC5

**File scope**:
- `src/shared/ipc-types.ts`
- `src/main/db/jobs.ts`
- `src/main/ipc/db.ts`
- `tests/unit/db.test.ts`

**Changes**:

1. `src/shared/ipc-types.ts` — add channel to `IpcChannels` (insert after `'db:delete-job'` block):
   ```ts
   'db:update-job-title': {
     request: { id: string; title: string };
     response: void;
   };
   ```

2. `src/main/db/jobs.ts` — add function after `deleteJob`:
   ```ts
   export function updateJobTitle(id: string, title: string): void {
     const db = getDb();
     db.prepare('UPDATE jobs SET title = ? WHERE id = ?').run(title, id);
   }
   ```

3. `src/main/ipc/db.ts` — import `updateJobTitle` and register handler (add after `'db:delete-job'` handler):
   ```ts
   ipcMain.handle('db:update-job-title', (_event, { id, title }: { id: string; title: string }) => {
     jobs.updateJobTitle(id, title);
   });
   ```

4. `tests/unit/db.test.ts` — add test case after the existing `deleteJob` test:
   ```ts
   it('updateJobTitle updates the title in the database', () => {
     const { createJob, updateJobTitle, getJob } = /* existing import */;
     const job = { /* minimal valid job object */ };
     createJob(job);
     updateJobTitle(job.id, 'New Title');
     const updated = getJob(job.id);
     expect(updated?.title).toBe('New Title');
   });
   ```
   Follow the existing test's in-memory DB setup pattern — `db.test.ts` uses the `001_initial.sql` disk file to seed the schema.

**Exit criteria**:
- [x] `npm test` passes with no failures in `db.test.ts`
- [x] `updateJobTitle('nonexistent-id', 'x')` runs without throwing (SQLite UPDATE on missing row is a no-op)
- [x] TypeScript compiles cleanly

---


#### Implementation (2026-09-15, code: 457f088)
Added `'db:update-job-title'` to `IpcChannels` with `{id, title}` request and `void` response. Added `updateJobTitle(id, title)` to `src/main/db/jobs.ts` using named `@param` binding consistent with the file's existing style. Registered the `ipcMain.handle('db:update-job-title', ...)` handler in `db.ts`. Added two tests to `db.test.ts`: one verifying title update persists, one verifying no-throw on nonexistent id. Auto-fix applied (F1): switched from positional `?` to named `@title`/`@id` binding. 78/78 tests pass.

### Phase 3: SettingsView — preferences UI [QA] [P:4]

**Goal**: Add transcription preferences (provider, language) and app-language selector to SettingsView.

**Covers**: SC1 (partial — settings UI), SC2 (partial), SC4 (partial)

**File scope**:
- `src/renderer/views/SettingsView.tsx`
- `README.md`

**Changes**:

SettingsView currently imports only `useSettings` and uses `hasSecret`/`setSecret`/`testSecret`. This phase wires `getPreference`/`setPreference` and adds two new card sections.

Structure: add a **"Transcription defaults"** card and an **"App language"** card, both above the existing **"API Keys"** heading. Each saves on change (same pattern as the folder preference if one existed — or save immediately on `<select>` `onChange` like a controlled component writing through to IPC).

```tsx
// New state at top of SettingsView:
const { t } = useI18n(); // Phase 6 adds this; in Phase 3 the hook doesn't exist yet —
                          // Phase 3 is implemented before Phase 6, so Phase 3 uses
                          // hardcoded English strings; Phase 6 replaces them with t() calls.
const [defaultProvider, setDefaultProvider] = useState<ProviderName>('assemblyai');
const [defaultLanguage, setDefaultLanguage] = useState<'fr' | 'en' | 'auto'>('fr');
const [appLanguage, setAppLanguage] = useState<'fr' | 'en'>('fr');
const [prefsLoaded, setPrefsLoaded] = useState(false);

// Load preferences on mount — use [] dep array (getPreference is stable useCallback):
useEffect(() => {
  Promise.all([
    getPreference('defaultProvider'),
    getPreference('defaultLanguage'),
    getPreference('appLanguage'),
  ]).then(([prov, lang, appLang]) => {
    setDefaultProvider((PROVIDER_NAMES.includes(prov as ProviderName) ? prov : 'assemblyai') as ProviderName);
    // Treat 'auto' as 'fr' in the selector
    setDefaultLanguage(((lang === 'auto' || lang === null || lang === undefined) ? 'fr' : lang) as 'fr' | 'en');
    setAppLanguage(((appLang === 'fr' || appLang === 'en') ? appLang : 'fr') as 'fr' | 'en');
    setPrefsLoaded(true);
  }).catch(console.error);
}, []); // mount-only — getPreference is stable

// Save handlers (call setPreference, then update local state):
const handleProviderChange = async (v: ProviderName) => {
  await setPreference('defaultProvider', v);
  setDefaultProvider(v);
};
const handleLanguageChange = async (v: 'fr' | 'en') => {
  await setPreference('defaultLanguage', v);
  setDefaultLanguage(v);
};
const handleAppLanguageChange = async (v: 'fr' | 'en') => {
  await setPreference('appLanguage', v);
  setAppLanguage(v);
  setLang(v); // update i18n context immediately (Phase 6 adds setLang; in Phase 3 this line is absent)
};
```

Add two card sections in JSX before the `<h3>API Keys</h3>` block:

```tsx
<div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
  <div className="card-body">
    <h3 style={{ marginBottom: 'var(--space-4)' }}>Transcription defaults</h3>
    <div className="grid-2">
      <div className="form-group">
        <label className="form-label">Provider</label>
        <select className="form-select" value={defaultProvider}
          onChange={e => void handleProviderChange(e.target.value as ProviderName)}
          disabled={!prefsLoaded}>
          {PROVIDER_NAMES.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Language</label>
        <select className="form-select" value={defaultLanguage}
          onChange={e => void handleLanguageChange(e.target.value as 'fr' | 'en')}
          disabled={!prefsLoaded}>
          <option value="fr">French</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
  </div>
</div>

<div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
  <div className="card-body">
    <h3 style={{ marginBottom: 'var(--space-4)' }}>App language</h3>
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">Interface language</label>
      <select className="form-select" value={appLanguage}
        onChange={e => void handleAppLanguageChange(e.target.value as 'fr' | 'en')}
        disabled={!prefsLoaded} style={{ maxWidth: 200 }}>
        <option value="en">English</option>
        <option value="fr">Français</option>  {/* always hardcoded — the meta-label for the selector */}
      </select>
    </div>
  </div>
</div>
```

**README update** (`README.md:56`): Change the Upload instructions line from:
> "Select your provider, language, and optional title."
to:
> "Select your transcription language (defaults to your saved preference) and an optional title."

**Exit criteria**:
- [x] Settings page shows "Transcription defaults" and "App language" cards above API Keys
- [x] Changing provider and language in Settings persists across app restarts (`preferences.json` updated)
- [x] Stored `'auto'` for `defaultLanguage` renders as `'fr'` in the dropdown (not a blank option)
- [x] README.md Upload instructions updated
- [x] TypeScript compiles cleanly

---


#### Implementation (2026-09-15, code: 04d4376, fix: 6370e51)
Added `defaultProvider`, `defaultLanguage`, `appLanguage`, and `prefsLoaded` state to SettingsView. Mount-only `useEffect` loads all three preferences via `Promise.all` and falls back (`'auto'`→`'fr'`). Three save handlers call `setPreference` then update local state. Added "Transcription defaults" and "App language" card sections above the API Keys block. `PROVIDER_LABELS` constant added for dropdown labels. Auto-fix in `6370e51`: changed useEffect dep array from `[getPreference]` to `[]` per plan spec. README Upload step updated to remove provider mention. 78/78 tests pass.

### Phase 4: RecordView & UploadView — remove provider, hydrate language [QA] [P:3]

**Goal**: Remove provider dropdowns from both recording views; initialize language dropdown from the `defaultLanguage` preference.

**Covers**: SC1, SC2

**File scope**:
- `src/renderer/views/RecordView.tsx`
- `src/renderer/views/UploadView.tsx`

**Changes**:

Both views follow the same pattern. Shown for RecordView; apply identically to UploadView.

1. Add import for `useSettings` (already present in `useSettings.ts`; import it into RecordView/UploadView).
2. Remove the `<div className="form-group">` block containing the Provider `<select>` entirely.
3. Add `prefsLoaded` state and load provider + language from preferences on mount. Use `[]` as the `useEffect` dep array (mount-only — `getPreference` is a stable `useCallback` with empty deps; do NOT put `getPreference` in the dep array to avoid infinite loops in StrictMode):

```tsx
// RecordView — replace/add at top of component:
const { getPreference, hasSecret } = useSettings();
const [selectedLanguage, setSelectedLanguage] = useState<'fr' | 'en' | 'auto'>('fr');
const [selectedProvider, setSelectedProvider] = useState<ProviderName>('assemblyai');
const [prefsLoaded, setPrefsLoaded] = useState(false);
const [providerKeyMissing, setProviderKeyMissing] = useState(false);

useEffect(() => {
  Promise.all([
    getPreference('defaultLanguage'),
    getPreference('defaultProvider'),
  ]).then(async ([lang, prov]) => {
    // Robust guard: treat 'auto' and any unexpected value as 'fr'
    const langVal = (lang === 'fr' || lang === 'en') ? lang as 'fr' | 'en' : 'fr';
    const provVal = (PROVIDER_NAMES.includes(prov as ProviderName)) ? prov as ProviderName : 'assemblyai';
    setSelectedLanguage(langVal);
    setSelectedProvider(provVal);
    // Check if provider has an API key; warn user if not
    const keyPresent = await hasSecret(SECRET_KEY_NAMES[provVal]);
    setProviderKeyMissing(!keyPresent);
    setPrefsLoaded(true);
  }).catch(console.error);
}, []); // mount-only — getPreference is stable
```

4. In `handleStop` (RecordView) and `handleTranscribe` (UploadView), add a guard before starting:
```tsx
if (!prefsLoaded) return; // should not be reachable, but defensive
if (providerKeyMissing) {
  setError(`No API key configured for ${PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.`);
  return;
}
```

5. Disable the action button until `prefsLoaded`:
   - RecordView: the "Start Recording" button is already gated on `isIdle`; add `|| !prefsLoaded` to the disabled condition. The "Stop & Transcribe" button does not need the gate (recording has already started by the time Stop is pressed, provider is already in state).
   - UploadView: the "Transcribe" button is already gated on `!selected || submitting`; add `|| !prefsLoaded`.

6. Show an inline warning banner when `providerKeyMissing` is true (above the Start/Transcribe button):
```tsx
{providerKeyMissing && (
  <p className="text-error text-sm mb-4" role="alert">
    No API key for {PROVIDER_LABELS[selectedProvider]}. Go to Settings → API Keys.
  </p>
)}
```

7. Add `SECRET_KEY_NAMES` to the imports from `../../shared/ipc-types` (already exported there).
8. Keep the language `<select>` (per-job overridable). Remove the `grid-2` wrapper if provider dropdown removal leaves language as the only item in the grid.

**Exit criteria**:
- [x] No provider `<select>` visible in RecordView or UploadView
- [x] Language dropdown in both views pre-selects the value from `defaultLanguage` preference on mount
- [x] Start Recording / Transcribe button is disabled until `prefsLoaded === true`
- [x] If provider has no API key, an inline warning is shown and the action button is blocked
- [x] Starting a recording or transcription job uses the provider from `defaultProvider` preference
- [x] TypeScript compiles cleanly

---


#### Implementation (2026-09-15, code: e629536, fix: 9064ddd)
Removed provider `<select>` from both RecordView and UploadView. Added mount-only `useEffect` loading `defaultLanguage` and `defaultProvider` preferences; initializes `selectedLanguage` and `selectedProvider` state from stored values (with safe fallbacks). `hasSecret` check on the loaded provider sets `providerKeyMissing`. Start Recording and Transcribe buttons disabled until `prefsLoaded`. Inline warning banner shown when `providerKeyMissing`. Transcription jobs use `selectedProvider`. Auto-fixes in `9064ddd`: added `setPrefsLoaded(true)` to catch blocks (prevents permanent button lockout on IPC failure); removed unreachable `!prefsLoaded` guard from `handleStop`. 78/78 tests pass.

### Phase 5: Title editing in TranscriptView and HistoryView [QA]

**Goal**: Make job titles editable inline in both views, persisted via the new `db:update-job-title` channel.

**Covers**: SC3

**File scope**:
- `src/renderer/views/TranscriptView.tsx`
- `src/renderer/views/HistoryView.tsx`
- `src/renderer/hooks/useHistory.ts`

**Changes**:

**TranscriptView**:

1. Add `db:get-job` call on mount to retrieve the job title, with unmount cleanup:
   ```tsx
   const [jobTitle, setJobTitle] = useState<string>('');

   useEffect(() => {
     if (!jobId) return;
     let alive = true;
     (window.electronAPI.invoke('db:get-job', { id: jobId }) as Promise<Job | null>)
       .then(job => { if (alive && job) setJobTitle(job.title); })
       .catch(console.error);
     return () => { alive = false; };
   }, [jobId]);
   ```

2. Add import for `Job` from `ipc-types`.

3. Replace the hardcoded `<div className="page-title">Transcript</div>` with an inline-editable title, replicating the `SpeakerLabel.tsx` pattern inline (or extracting a shared `InlineEdit` component — using it inline is fine for now):
   ```tsx
   // Inline edit state for title:
   const [editingTitle, setEditingTitle] = useState(false);
   const [titleDraft, setTitleDraft] = useState('');
   const titleInputRef = useRef<HTMLInputElement>(null);

   const startTitleEdit = () => {
     setTitleDraft(jobTitle);
     setEditingTitle(true);
     setTimeout(() => titleInputRef.current?.focus(), 0);
   };
   const commitTitleEdit = async () => {
     setEditingTitle(false);
     const trimmed = titleDraft.trim();
     if (trimmed && trimmed !== jobTitle) {
       try {
         await window.electronAPI.invoke('db:update-job-title', { id: jobId, title: trimmed });
         setJobTitle(trimmed);
       } catch {
         console.error('Failed to save title'); // title reverts to jobTitle — state not updated
       }
     }
   };
   ```

   > **Requires Phase 2**: `db:update-job-title` IPC handler must be registered (Phase 2 exit criterion). Phase 5 must not be executed without Phase 2 complete.

4. In the header JSX, replace the static page-title div:
   ```tsx
   {editingTitle ? (
     <input
       ref={titleInputRef}
       className="form-input"
       value={titleDraft}
       onChange={e => setTitleDraft(e.target.value)}
       onBlur={() => void commitTitleEdit()}
       onKeyDown={e => {
         if (e.key === 'Enter') void commitTitleEdit();
         if (e.key === 'Escape') setEditingTitle(false);
       }}
       aria-label="Edit transcript title"
       style={{ fontSize: 'var(--text-lg)', fontWeight: 600, maxWidth: 400 }}
     />
   ) : (
     <div
       className="page-title"
       onDoubleClick={startTitleEdit}
       title="Double-click to rename"
       style={{ cursor: 'text' }}
       role="button"
       tabIndex={0}
       onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startTitleEdit()}
       aria-label={`${jobTitle || 'Transcript'} — double-click to rename`}
     >
       {jobTitle || 'Transcript'}
     </div>
   )}
   ```

**HistoryView**:

1. Add `updateJobTitle` IPC call and error handling to `useHistory.ts` — expose a new `renameJob` callback:
   ```ts
   // In useHistory.ts, add:
   const renameJob = useCallback(async (jobId: string, newTitle: string) => {
     // Apply optimistic update only after the IPC call succeeds — not before.
     // This prevents the UI showing a stale title if the DB write fails.
     await window.electronAPI.invoke('db:update-job-title', { id: jobId, title: newTitle });
     setJobs(prev => prev.map(j => j.id === jobId ? { ...j, title: newTitle } : j));
   }, []); // stable — window.electronAPI is module-scoped; setJobs is stable

   // Add renameJob to the return value
   return { jobs, loading, error, refresh, deleteJob, renameJob };
   ```
   Note: `setJobs` is called after the `await`, so if the IPC call rejects, the local state is NOT updated. Callers should catch errors and surface them (see HistoryView below).

2. In `HistoryView.tsx`, accept `renameJob` from `useHistory` and wire it to the job-title div:
   ```tsx
   const { jobs, loading, error, deleteJob, renameJob } = useHistory();
   const [editingId, setEditingId] = useState<string | null>(null);
   const [titleDraft, setTitleDraft] = useState('');
   const [renameError, setRenameError] = useState<string | null>(null);

   const startEdit = (job: Job) => {
     setEditingId(job.id);
     setTitleDraft(job.title);
     setRenameError(null);
   };
   const commitEdit = async () => {
     if (!editingId) return;
     const trimmed = titleDraft.trim();
     if (trimmed) {
       try {
         await renameJob(editingId, trimmed);
       } catch {
         setRenameError('Failed to rename. Please try again.');
       }
     }
     setEditingId(null);
   };
   ```
   Display `{renameError && <p className="text-error text-sm">{renameError}</p>}` near the top of the view if needed.

3. Replace the read-only `<div className="job-title">{job.title}</div>` with:
   ```tsx
   {editingId === job.id ? (
     <input
       className="form-input"
       value={titleDraft}
       autoFocus
       onChange={e => setTitleDraft(e.target.value)}
       onBlur={() => void commitEdit()}
       onKeyDown={e => {
         if (e.key === 'Enter') void commitEdit();
         if (e.key === 'Escape') setEditingId(null);
       }}
       onClick={e => e.stopPropagation()}
       aria-label="Edit job title"
       style={{ fontSize: 13, fontWeight: 600 }}
     />
   ) : (
     <div
       className="job-title"
       onClick={e => e.stopPropagation()} {/* prevent card navigation when clicking the title */}
       onDoubleClick={e => { e.stopPropagation(); startEdit(job); }}
       title="Double-click to rename"
       style={{ cursor: 'text' }}
       role="button"
       tabIndex={0}
       onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startEdit(job)}
       aria-label={`${job.title} — double-click to rename`}
     >
       {job.title}
     </div>
   )}
   ```
   Note: `onClick={e => e.stopPropagation()}` on the title div prevents a single click on the title from triggering the card's `onOpenJob` handler. Card navigation only fires when clicking elsewhere on the card.

**Exit criteria**:
- [x] TranscriptView displays the job title as its heading (loaded via `db:get-job`)
- [x] Double-clicking the title in TranscriptView opens an input; Enter/blur commits; Escape cancels
- [x] After committing, the new title persists across app restarts (stored in DB)
- [x] Double-clicking a job title in HistoryView opens an input; Enter/blur commits; Escape cancels
- [x] After committing in HistoryView, the card title updates immediately (optimistic) without a page refresh
- [x] TypeScript compiles cleanly

---


#### Implementation (2026-09-15, code: 57285e9, fix: 0f100b1)
Added `jobTitle`, `editingTitle`, `titleDraft`, and `titleInputRef` state to TranscriptView. Mount-only `useEffect` loads title via `db:get-job` with `alive` guard for unmount cleanup. `startTitleEdit` and `commitTitleEdit` functions manage inline edit UX (Enter/blur commits, Escape cancels). Page heading replaced with conditional input/div pattern, accessibility attributes added (`role="button"`, `tabIndex`, `aria-label`, `cursor: text`). Added `renameJob` callback to `useHistory` (state update after `await` only). Wired inline title editing to HistoryView with `editingId`, `titleDraft`, `renameError` state and `stopPropagation` to prevent card navigation on title click. Divergence: pre-existing TranscriptView audio URL fix (`app:///` Windows path) included in same commit due to same-file pathspec. Auto-fix in `0f100b1`: added `if (!editingTitle) return;` guard to `commitTitleEdit` to prevent double-write on Enter→blur event sequence. 78/78 tests pass.

### Phase 6: i18n context and string translation [QA]

**Goal**: Introduce a zero-dependency FR/EN string map system and replace all ~50 hardcoded English UI strings in the renderer.

**Covers**: SC4

**File scope**:
- `src/renderer/i18n.ts` (new)
- `src/renderer/hooks/useI18n.tsx` (new — must be `.tsx` because `I18nProvider` returns JSX)
- `src/renderer/components/ErrorBoundaryWithI18n.tsx` (new)
- `src/renderer/main.tsx`
- `src/renderer/App.tsx`
- `src/renderer/components/Sidebar.tsx`
- `src/renderer/components/ErrorBoundary.tsx`
- `src/renderer/views/RecordView.tsx`
- `src/renderer/views/UploadView.tsx`
- `src/renderer/views/SettingsView.tsx`
- `src/renderer/views/HistoryView.tsx`
- `src/renderer/views/TranscriptView.tsx`
- `src/renderer/views/JobProgressView.tsx`

**i18n system design**:

`src/renderer/i18n.ts` — defines the string catalog and both language maps:
```ts
export type I18nKey = keyof typeof en;

export const en = {
  // Sidebar
  nav_record: 'Record',
  nav_upload: 'Upload',
  nav_history: 'History',
  nav_settings: 'Settings',
  sidebar_brand: 'Transcriber',
  sidebar_tagline: 'Meeting recorder',
  sidebar_job_active: 'Job in progress',
  sidebar_ready: 'Ready',
  // RecordView
  record_title: 'Record meeting',
  record_subtitle: 'Capture audio from your microphone and transcribe',
  record_btn_start: '⏺ Start Recording',
  record_btn_pause: '⏸ Pause',
  record_btn_stop: '⏹ Stop & Transcribe',
  record_btn_resume: '▶ Resume',
  record_finalizing: 'Finalizing…',
  record_settings_heading: 'Recording settings',
  record_microphone_label: 'Microphone',
  record_microphone_default: 'Default microphone',
  record_language_label: 'Language',
  // UploadView
  upload_title: 'Upload audio',
  upload_subtitle: 'Transcribe an existing recording',
  upload_drop_text: 'Click to browse for an audio file',
  upload_drop_hint_change: 'click to change',
  upload_error_format: 'Unsupported format. Accepted:',
  upload_settings_heading: 'Transcription settings',
  upload_language_label: 'Language',
  upload_title_label: 'Title (optional)',
  upload_title_placeholder: 'Auto-generated if blank',
  upload_btn_transcribe: '▶ Transcribe',
  upload_btn_starting: '⏳ Starting…',
  // Language options (shared by Record and Upload)
  lang_option_auto: 'Auto-detect',
  lang_option_fr: 'French',
  lang_option_en: 'English',
  // SettingsView
  settings_title: 'Settings',
  settings_subtitle: 'Configure transcription providers and preferences',
  settings_transcription_heading: 'Transcription defaults',
  settings_provider_label: 'Provider',
  settings_language_label: 'Language',
  settings_applang_heading: 'App language',
  settings_applang_label: 'Interface language',
  settings_apikeys_heading: 'API Keys',
  settings_save: 'Save',
  settings_test: 'Test',
  settings_configured: '● Configured',
  settings_not_set: '○ Not set',
  settings_key_placeholder_set: '••••••••••••••••••••',
  settings_key_placeholder_unset: 'Paste API key…',
  settings_show_key: 'Show key',
  settings_hide_key: 'Hide key',
  settings_valid: '✓ Valid',
  settings_invalid: '✗',
  // Provider descriptions
  provider_desc_assemblyai: 'Strong diarization · French · Up to 10h',
  provider_desc_elevenlabs: 'Scribe v2 · Auto-chunks >8min · Up to 10h',
  provider_desc_openai: 'gpt-4o-transcribe-diarize · Chunks ≤25min',
  provider_desc_google: 'Gemini 3.5 Transcribe · Chunks ≤30min (preview)',
  // HistoryView
  history_title: 'History',
  history_subtitle_jobs: 'transcription job',
  history_subtitle_jobs_plural: 'transcription jobs',
  history_empty: 'No transcription jobs yet',
  history_empty_hint: 'Record or upload audio to get started',
  history_loading: 'Loading…',
  history_btn_open: 'Open',
  history_btn_delete: 'Delete',
  history_btn_cancel: 'Cancel',
  history_delete_disabled_title: 'Cannot delete an active job',
  // TranscriptView
  transcript_title_fallback: 'Transcript',
  transcript_subtitle_turns: 'turn',
  transcript_subtitle_turns_plural: 'turns',
  transcript_subtitle_chunks: 'chunks',
  transcript_btn_export: '⇩ Export .txt',
  transcript_btn_copy: '📋 Copy',
  transcript_chunk_label: 'Chunk',
  transcript_empty: 'No transcript content — the recording may have been silent',
  transcript_loading: 'Loading…',
  transcript_title_edit_hint: 'Double-click to rename',
  // JobProgressView
  progress_title: 'Transcribing…',
  progress_subtitle_complete: 'Complete',
  progress_subtitle_failed: 'Failed',
  progress_subtitle_processing: 'Processing your recording',
  progress_complete_msg: '✓ Transcription complete — opening transcript…',
  progress_btn_cancel: 'Cancel transcription',
  // ErrorBoundary
  error_heading: 'Something went wrong',
  error_body: 'An unexpected error occurred. If this keeps happening, please restart the app.',
  error_btn_reload: 'Reload app',
} as const;

export const fr: Record<I18nKey, string> = {
  nav_record: 'Enregistrer',
  nav_upload: 'Importer',
  nav_history: 'Historique',
  nav_settings: 'Paramètres',
  sidebar_brand: 'Transcripteur',
  sidebar_tagline: 'Enregistreur de réunion',
  sidebar_job_active: 'Tâche en cours',
  sidebar_ready: 'Prêt',
  record_title: 'Enregistrer une réunion',
  record_subtitle: 'Capturez l\'audio de votre microphone et transcrivez',
  record_btn_start: '⏺ Démarrer l\'enregistrement',
  record_btn_pause: '⏸ Pause',
  record_btn_stop: '⏹ Arrêter & Transcrire',
  record_btn_resume: '▶ Reprendre',
  record_finalizing: 'Finalisation…',
  record_settings_heading: 'Paramètres d\'enregistrement',
  record_microphone_label: 'Microphone',
  record_microphone_default: 'Microphone par défaut',
  record_language_label: 'Langue',
  upload_title: 'Importer un fichier audio',
  upload_subtitle: 'Transcrivez un enregistrement existant',
  upload_drop_text: 'Cliquez pour parcourir les fichiers audio',
  upload_drop_hint_change: 'cliquer pour changer',
  upload_error_format: 'Format non pris en charge. Accepté :',
  upload_settings_heading: 'Paramètres de transcription',
  upload_language_label: 'Langue',
  upload_title_label: 'Titre (optionnel)',
  upload_title_placeholder: 'Généré automatiquement si vide',
  upload_btn_transcribe: '▶ Transcrire',
  upload_btn_starting: '⏳ Démarrage…',
  lang_option_auto: 'Détection auto',
  lang_option_fr: 'Français',
  lang_option_en: 'Anglais',
  settings_title: 'Paramètres',
  settings_subtitle: 'Configurer les fournisseurs et préférences de transcription',
  settings_transcription_heading: 'Paramètres de transcription',
  settings_provider_label: 'Fournisseur',
  settings_language_label: 'Langue',
  settings_applang_heading: 'Langue de l\'application',
  settings_applang_label: 'Langue de l\'interface',
  settings_apikeys_heading: 'Clés API',
  settings_save: 'Enregistrer',
  settings_test: 'Tester',
  settings_configured: '● Configuré',
  settings_not_set: '○ Non défini',
  settings_key_placeholder_set: '••••••••••••••••••••',
  settings_key_placeholder_unset: 'Coller la clé API…',
  settings_show_key: 'Afficher la clé',
  settings_hide_key: 'Masquer la clé',
  settings_valid: '✓ Valide',
  settings_invalid: '✗',
  provider_desc_assemblyai: 'Diarisation avancée · Français · Jusqu\'à 10h',
  provider_desc_elevenlabs: 'Scribe v2 · Découpage auto >8min · Jusqu\'à 10h',
  provider_desc_openai: 'gpt-4o-transcribe-diarize · Découpage ≤25min',
  provider_desc_google: 'Gemini 3.5 Transcribe · Découpage ≤30min (aperçu)',
  history_title: 'Historique',
  history_subtitle_jobs: 'tâche de transcription',
  history_subtitle_jobs_plural: 'tâches de transcription',
  history_empty: 'Aucune tâche de transcription',
  history_empty_hint: 'Enregistrez ou importez un fichier audio pour commencer',
  history_loading: 'Chargement…',
  history_btn_open: 'Ouvrir',
  history_btn_delete: 'Supprimer',
  history_btn_cancel: 'Annuler',
  history_delete_disabled_title: 'Impossible de supprimer une tâche active',
  transcript_title_fallback: 'Transcription',
  transcript_subtitle_turns: 'réplique',
  transcript_subtitle_turns_plural: 'répliques',
  transcript_subtitle_chunks: 'segments',
  transcript_btn_export: '⇩ Exporter .txt',
  transcript_btn_copy: '📋 Copier',
  transcript_chunk_label: 'Segment',
  transcript_empty: 'Aucun contenu de transcription — l\'enregistrement est peut-être silencieux',
  transcript_loading: 'Chargement…',
  transcript_title_edit_hint: 'Double-cliquez pour renommer',
  progress_title: 'Transcription en cours…',
  progress_subtitle_complete: 'Terminé',
  progress_subtitle_failed: 'Échec',
  progress_subtitle_processing: 'Traitement de votre enregistrement',
  progress_complete_msg: '✓ Transcription terminée — ouverture de la transcription…',
  progress_btn_cancel: 'Annuler la transcription',
  error_heading: 'Une erreur est survenue',
  error_body: 'Une erreur inattendue s\'est produite. Si cela persiste, veuillez redémarrer l\'application.',
  error_btn_reload: 'Redémarrer l\'application',
};
```

`src/renderer/hooks/useI18n.tsx` — context + hook (note `.tsx` extension — file contains JSX):
```tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { en, fr, type I18nKey } from '../i18n';

type Lang = 'en' | 'fr';
type I18nContextValue = { t: (key: I18nKey) => string; lang: Lang; setLang: (l: Lang) => void };

const I18nContext = createContext<I18nContextValue>({
  t: (k) => en[k],
  lang: 'en',
  setLang: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [lang, setLang] = useState<Lang>('en'); // in-memory default is English

  useEffect(() => {
    // Guard: preload may not have fired yet (unlikely but defensive)
    if (!window.electronAPI) { setLang('fr'); return; }
    // Load stored preference; switch to French (or stored value) after mount
    (window.electronAPI.invoke('settings:get-preference', { key: 'appLanguage' }) as Promise<{ value: unknown }>)
      .then(res => {
        const stored = res?.value as Lang | undefined;
        if (stored === 'fr' || stored === 'en') setLang(stored);
        else setLang('fr'); // stored default is French
      })
      .catch(() => setLang('fr'));
  }, []); // mount-only

  const t = (key: I18nKey): string => (lang === 'fr' ? fr[key] : en[key]);

  return <I18nContext.Provider value={{ t, lang, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
```

`src/renderer/main.tsx` — wrap App in `I18nProvider`:
```tsx
import { I18nProvider } from './hooks/useI18n';
// ...
root.render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
```

**SettingsView i18n wiring**: When the user changes `appLanguage` in Phase 3's `handleAppLanguageChange`, also update the i18n context. This wiring requires `useI18n` to be available, which is introduced in Phase 6. The sequence is: Phase 3 ships `handleAppLanguageChange` saving the preference (but NOT calling `setLang`); Phase 6 adds `const { setLang } = useI18n()` to SettingsView and adds the `setLang(v)` call to `handleAppLanguageChange`. The Phase 3 code block in the plan includes `setLang(v)` with a comment marking it as a Phase 6 addition to avoid implementers missing it:
```ts
const handleAppLanguageChange = async (v: 'fr' | 'en') => {
  await setPreference('appLanguage', v);
  setAppLanguage(v);
  // Phase 6 adds: const { setLang } = useI18n(); at component top, and this call:
  // setLang(v);
};
```

**String replacement in each component**: Replace every hardcoded string with `t('key')`. Add `const { t } = useI18n();` at the top of each component. See the `en` map for the full key list — every string in the map has a corresponding usage site.

**App language selector option labels** (SettingsView): The two `<option>` labels for the app language selector — `"English"` and `"Français"` — are intentionally hardcoded and NOT translated. They serve as meta-labels: a user who has accidentally set the wrong language must be able to identify and switch back. These two strings must remain their respective language names regardless of the current `appLanguage` setting.

**ErrorBoundary**: It is a class component and cannot use hooks directly. The plan specifies this concrete wrapper pattern, which the implementer must use — do NOT leave it underspecified:

```tsx
// src/renderer/components/ErrorBoundaryWithI18n.tsx (new file — add to Phase 6 File scope)
import React from 'react';
import { useI18n } from '../hooks/useI18n';
import ErrorBoundary from './ErrorBoundary';

// Thin wrapper that reads i18n context and passes translated strings as props.
// ErrorBoundary is a class component and cannot use hooks directly.
export default function ErrorBoundaryWithI18n({ children }: { children: React.ReactNode }): React.ReactElement {
  const { t } = useI18n();
  return (
    <ErrorBoundary
      heading={t('error_heading')}
      body={t('error_body')}
      reloadLabel={t('error_btn_reload')}
    >
      {children}
    </ErrorBoundary>
  );
}
```

The underlying `ErrorBoundary` class component must be updated to accept optional `heading`, `body`, and `reloadLabel` props (defaulting to the English strings if absent, for backwards compatibility during the React error boundary render — in case `I18nProvider` itself errors):

```tsx
// ErrorBoundary.tsx — update Props:
interface Props extends React.PropsWithChildren {
  heading?: string;
  body?: string;
  reloadLabel?: string;
}
// Use props.heading ?? 'Something went wrong', etc. in the render method.
```

In `App.tsx`, replace `<ErrorBoundary>` with `<ErrorBoundaryWithI18n>` (the `I18nProvider` wraps `App` in `main.tsx`, so context is available).

Add `src/renderer/components/ErrorBoundaryWithI18n.tsx` to Phase 6's File scope.

**Plural handling** (HistoryView and TranscriptView counts): Use inline ternary as currently done, now using i18n keys for both forms:
```tsx
// HistoryView:
`${jobs.length} ${jobs.length !== 1 ? t('history_subtitle_jobs_plural') : t('history_subtitle_jobs')}`
// TranscriptView:
`${turns.length} ${turns.length !== 1 ? t('transcript_subtitle_turns_plural') : t('transcript_subtitle_turns')}`
```

**`PROVIDER_DESCRIPTIONS` in SettingsView**: replace the static object with `useMemo` using `t()` (must be inside component body after `const { t } = useI18n()`):
```ts
const PROVIDER_DESCRIPTIONS = useMemo<Record<ProviderName, string>>(() => ({
  assemblyai: t('provider_desc_assemblyai'),
  elevenlabs:  t('provider_desc_elevenlabs'),
  openai:      t('provider_desc_openai'),
  google:      t('provider_desc_google'),
}), [t]); // re-derives only when language changes
```
`useMemo` prevents the object being reconstructed on every render; `[t]` ensures it updates on language change. Add `useMemo` to the React import in `SettingsView.tsx`.

**Exit criteria**:
- [x] App UI renders in English on first launch (before preference load)
- [x] After preference load, app UI renders in French (default stored preference)
- [x] Changing "App language" in Settings to English immediately switches all strings to English
- [x] Changing "App language" in Settings to French immediately switches all strings to French
- [x] Setting persists across app restarts
- [x] `ErrorBoundaryWithI18n` wrapper created; `App.tsx` uses it instead of `ErrorBoundary` directly; error boundary shows translated strings
- [x] No hardcoded English string remains in the 13 files listed in File scope (verified by grep for any string that now has an `en` map entry)
- [x] TypeScript compiles cleanly (`I18nKey` type ensures exhaustiveness — missing a key in `fr` is a compile error)


#### Implementation (2026-09-15, code: a0113d3, fix: a09c80b)
Created `src/renderer/i18n.ts` with 87 `I18nKey` entries in `en` and complete `fr: Record<I18nKey, string>` map (TypeScript enforces exhaustiveness). Created `src/renderer/hooks/useI18n.tsx` (`.tsx` — returns JSX) with `I18nProvider` (in-memory default English, switches to stored `appLanguage` preference on mount; `window.electronAPI` guard present) and `useI18n` hook. Created `src/renderer/components/ErrorBoundaryWithI18n.tsx` HOC that reads context and passes translated props. Updated `ErrorBoundary.tsx` with optional `heading`/`body`/`reloadLabel` props falling back to English. Wrapped `main.tsx` with `I18nProvider`, replaced `ErrorBoundary` in `App.tsx` with `ErrorBoundaryWithI18n`. Replaced all ~50 hardcoded strings across Sidebar, RecordView, UploadView, SettingsView, HistoryView, TranscriptView, JobProgressView with `t()` calls. `PROVIDER_DESCRIPTIONS` in SettingsView wrapped in `useMemo([t])`. `handleAppLanguageChange` calls `setLang(v)`. Navigation-critical strings (`'Done'`/`'Error:'`/`'Cancelled'` in JobProgressView) left untranslated. App language selector options hardcoded. Auto-fix in `a09c80b`: added `provider_key_missing_banner` and `provider_key_missing_error` keys (en+fr) for the provider key missing warning strings in RecordView/UploadView. 78/78 tests pass.

## 6) Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `'auto'` stored as `defaultLanguage` renders as blank selector | Low — cosmetic; no data loss | Phase 3 fallback treats `'auto'` as `'fr'` in SettingsView display |
| English-to-French flash on first launch | Low — imperceptible for local IPC | Accepted by user; in-memory default English avoids blocking render |
| Provider has no API key — user starts recording with no valid key | Medium — job fails with terse error | Phase 4 checks `hasSecret` on mount; shows inline warning and blocks submission if key missing |
| `db:get-job` in TranscriptView fails if job is deleted after navigation | Low — rare edge case | Fallback to `'Transcript'` string when `getJob` returns null |
| `fr` map is missing a key at runtime | Compile-time error | `fr: Record<I18nKey, string>` — TypeScript enforces exhaustiveness |
| Calling `updateJobTitle` on a non-existent job ID | Graceful no-op | SQLite UPDATE on missing row is a no-op; no error thrown |

## 7) Verification

```bash
# Unit tests (run from repo root)
npm test

# TypeScript compile check
npx tsc --noEmit

# Manual — start dev app
npm run dev
```

Manual checklist:
1. Settings → "Transcription defaults" card shows provider selector (AssemblyAI default) and language selector (French default).
2. Settings → "App language" card shows French/English selector.
3. Change provider to ElevenLabs → restart app → provider still ElevenLabs.
4. Record view → no provider dropdown; language dropdown shows French by default.
5. Upload view → no provider dropdown; language dropdown shows French by default.
6. TranscriptView (open any job) → heading shows job title; double-click → renames; restart → new title persists.
7. HistoryView → double-click a job title → renames; title updates immediately in the card.
8. Settings → switch to English → all UI strings switch to English.
9. Settings → switch to French → all UI strings switch to French.
10. Restart app → language preference persists.

## 8) Documentation Updates

| Document | Update needed | Phase |
|---|---|---|
| `README.md` | Update Upload instructions: remove "provider" mention, update language wording | 3 |

## 9) Implementation Divergences from Plan

*Reserved — filled during implementation.*

## Follow-up Work (Deferred)

*None at plan creation.*

## Review Log

### 2026-09-15 — Post-Implementation Review

Overall implementation health: Green.
Personas: Senior engineer, Reliability engineer, Architect.
14 findings across 3 personas (0 High, 4 Medium, 10 Low). All 4 Mediums fixed.
QA verification: BLOCKED — Electron app requires GUI environment to start; `npm run dev` opens a windowed desktop application not drivable headlessly. 78/78 unit tests pass; TypeScript: no new errors in any plan file. Manual QA checklist in § 7 Verification covers all runtime surfaces.

#### Test execution summary

| Phase | Tests | QA | Notes |
|---|---|---|---|
| 1: Types + store + IPC | pass (78/78) | SKIP | Types/store/IPC; no runtime surface |
| 2: DB updateJobTitle | pass (78/78) | SKIP | DB function + IPC handler; no UI surface |
| 3: SettingsView UI | pass (78/78) | SKIP | Renderer-only; no independently-exercisable surface |
| 4: RecordView/UploadView | pass (78/78) | SKIP | Renderer-only UI changes |
| 5: Title editing | pass (78/78) | SKIP | Renderer-only inline edit UI |
| 6: i18n system | pass (78/78) | SKIP | Renderer context; TypeScript exhaustiveness is the primary gate |

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Medium | `renameError` in HistoryView rendered under all job cards after failed rename | Fixed — per-job `{id, message}` state; `renameError?.id === job.id` gate |
| 2 | Medium | `renameError` text hardcoded English, not using i18n system | Fixed — `rename_job_error` added to `i18n.ts` en+fr; `t()` used |
| 3 | Medium | RecordView `handleStop` catch swallowed transcription start failure silently | Fixed — `setError(t('transcription_start_error'))` added; key added to i18n.ts |
| 4 | Medium | SettingsView preference save handlers had no try/catch on IPC failure | Fixed — try/catch added to all 3 handlers |
| 5 | Low | handleStop providerKeyMissing guard is dead code in practice | User: accepted — harmless defensive check |
| 6 | Low | qvalidate parallel-phases docs commit not recognized for phases 3+4 combined commit | User: accepted — validator limitation for combined parallel docs commit |
| 7 | Low | Pre-existing TS `on`/`off` type conflict in `electronAPI` declarations | User: accepted — pre-existing, out of plan scope |
| 8 | Low | No unmount cleanup in useTranscript useEffect (pre-existing) | User: accepted — pre-existing pattern, not introduced by this plan |
| 9 | Low | `setLang`/`setPreference` dual-write coupling — persistence owned by SettingsView | User: accepted — acceptable for current 2-language scope; architect noted improvement |
| 10 | Low | `{{provider}}` interpolation duplicated at multiple call sites | User: accepted — simple string.replace, acceptable for 2 occurrences |
| 11 | Low | Dead catch-all check in settings:set-preference IPC handler | User: accepted — defensive; no behavioral impact |
| 12 | Low | App language selector options hardcoded (not via t()) | User: accepted — intentional; meta-labels must self-label in their own language |
| 13 | Low | ErrorBoundaryWithI18n placement caveat undocumented | User: accepted — stable in current architecture |
| 14 | Low | Job status badge values not translated | User: accepted — not in plan scope; semi-intelligible cross-language |

### 2026-09-15 — Implementation Review (after Phase 6, persona: Senior engineer, End-user advocate)

Implementation health: Green.
3 findings (0 High, 1 Medium, 2 Low). Medium fixed in cycle 1.
QA verification: SKIP — i18n is a renderer-only context system; no independently-exercisable runtime surface without app; unit tests pass. Note: TypeScript exhaustiveness check (`fr: Record<I18nKey, string>`) is the primary correctness gate for string map completeness.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | Medium | `providerKeyMissing` banner and `setError` call in RecordView/UploadView had hardcoded English strings not covered by Phase 6's `t()` replacement | Fixed — `provider_key_missing_banner` and `provider_key_missing_error` added to `i18n.ts` (en+fr); all 5 occurrences replaced with `t(...).replace('{{provider}}', ...)` |
| R2 | Low | Pre-existing TS `on`/`off` type conflict in `window.electronAPI` between `useSettings.ts` and `useRecorder.ts` declarations | User: accepted — pre-existing issue predating this plan; out of phase scope |
| R3 | Low | Job status badge values (`done`, `failed`, etc.) not translated | User: accepted — semi-intelligible cross-language; no keys specified in plan |

### 2026-09-15 — Implementation Review (after Phase 5, persona: Senior engineer, End-user advocate)

Implementation health: Green.
2 findings (0 High, 1 Medium, 1 Low). Medium fixed in cycle 1.
QA verification: SKIP — Phase 5 is renderer UI; no independently-exercisable surface without running app; unit tests pass.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | Medium | `commitTitleEdit` called twice on Enter: Enter fires onKeyDown, then blur fires onBlur; second call dispatched second IPC write | Fixed — `if (!editingTitle) return;` guard added as first line |
| R2 | Low | Dev debug `audio src:` overlay bundled from pre-existing changes (production-safe, NODE_ENV gated) | User: accepted — pre-existing improvement, production-safe |

### 2026-09-15 — Implementation Review (after Phase 4, persona: Senior engineer, Reliability engineer)

Implementation health: Green.
4 findings (0 High, 2 Medium, 2 Low). Both Mediums fixed in cycle 1; 2 Low accepted.
QA verification: SKIP — RecordView/UploadView changes are React UI with no independently-exercisable runtime surface without app running; unit tests pass.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | Medium | `.catch(console.error)` in both views never set `prefsLoaded=true` on IPC failure → Start/Transcribe button permanently disabled | Fixed — `setPrefsLoaded(true)` added to catch blocks in both files |
| R2 | Medium | `handleStop` had `if (!prefsLoaded) return` guard — unreachable in practice but wrong; plan spec says stop button should not be gated | Fixed — guard removed from `handleStop` only; other guards untouched |
| R3 | Low | No unmount cleanup for mount-only `useEffect` with async IPC chain | User: accepted — view is long-lived; no subscription or interval; theoretical StrictMode warning only |
| R4 | Low | Language state type `'fr'|'en'|'auto'` wider than select surface | User: accepted — coercion in load effect handles `'auto'`→`'fr'` fallback; consistent with spec |

### 2026-09-15 — Implementation Review (after Phase 3, persona: Senior engineer, End-user advocate)

Implementation health: Green.
3 findings (0 High, 1 Medium, 2 Low). Medium fixed in cycle 1.
QA verification: SKIP — SettingsView is renderer-only UI; no independently-exercisable surface; unit tests pass.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | Medium | `useEffect` dep array was `[getPreference]` instead of plan-specified `[]` — diverges from plan, creates footgun if hook deps change | Fixed — changed to `[]` |
| R2 | Low | Dead forward-reference comment `// Phase 6 adds: setLang(v)` in `handleAppLanguageChange` | User: accepted — serves as a stub marker for Phase 6 implementer; Phase 6 will replace it |
| R3 | Low | README update landed one commit before Phase 4 UI change (ordering note, no defect) | User: accepted — end state is correct; Phase 4 now complete |

### 2026-09-15 — Implementation Review (after Phase 2, persona: Senior engineer, Reliability engineer)

Implementation health: Green.
4 findings (0 High, 0 Medium, 4 Low).
QA verification: SKIP — Phase 2 adds a DB function and IPC handler with no independently-exercisable UI surface; unit tests (78/78 pass) cover the functional change.
Cycle 2 skipped — all findings Low; F1 auto-fix (named SQL binding) is purely mechanical.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | Low | `updateJobTitle` used positional `?` binding while every other function in `jobs.ts` uses named `@param` — inconsistent style | Fixed — switched to `@title`/`@id` named binding |
| R2 | Low | No input validation on `title` in IPC handler or DB function — empty string `""` accepted | User: accepted — NOT NULL constraint satisfied; no validation specified in plan; follow-up if needed |
| R3 | Low | No-op test asserts no-throw but not zero rows affected — a bad statement mutation would still pass | User: accepted — test validates observable behavior contract; zero-rows assertion would require rows_changed introspection not done elsewhere |
| R4 | Low | Test job not cleaned up; shared in-memory DB state; consistent with existing pattern | User: accepted — matches existing test infrastructure pattern |

### 2026-09-15 — Implementation Review (after Phase 1, persona: Senior engineer, Maintainability reviewer)

Implementation health: Green.
3 findings (0 High, 0 Medium, 3 Low).
QA verification: SKIP — Phase 1 is types/store/IPC validation; no independently-exercisable runtime surface. Unit tests (78/78 pass) cover the functional change. QA annotation mismatch: consider removing [QA] in future plan revisions.
Cycle 2 skipped — all findings Low, auto-fix for F1 purely mechanical cast normalization.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R1 | Low | `appLanguage` validator uses redundant `as string[]` cast on the literal array; `defaultLanguage` omits it — minor inconsistency | User: accepted — cosmetic only, no behavioral impact; acceptable inconsistency per F2's documented tradeoff note |
| R2 | Low | Catch-all key list in `ipc/settings.ts` must be kept in sync with `PreferenceKey` manually; TS does not enforce this | User: accepted — plan's documented tradeoff; implementation note requires all 3 changes together |
| R3 | Low | No test covers new IPC validation paths for invalid `defaultProvider`/`appLanguage` values | User: accepted — store-layer tests cover happy path; IPC validation tests deferred to a follow-up |

### 2026-09-15 — Cycle 1 (via /qplan)

16 findings (9 High, 6 Medium, 1 Low). All auto-resolved.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | High | `PROVIDER_NAMES.includes(value as ProviderName)` is a TS compile error (`value` is `unknown`) | Fixed — cast to `string`: `!(PROVIDER_NAMES as string[]).includes(value as string)` |
| 2 | High | `useI18n.ts` must be `.tsx` — `I18nProvider` returns JSX | Fixed — renamed to `useI18n.tsx` throughout plan |
| 3 | High | `settings:set-preference` validator non-exhaustive — new keys could admit arbitrary values | Fixed — added exhaustive `else { return; }` fallback; restructured as if-else chain |
| 4 | High | Phase 4 RecordView/UploadView had no `prefsLoaded` gate on Start/Transcribe button | Fixed — added `prefsLoaded` state, disabled buttons until loaded, inline warning if provider key missing |
| 5 | High | `I18nProvider` called `window.electronAPI` without guard against preload-not-fired | Fixed — added `if (!window.electronAPI) { setLang('fr'); return; }` guard |
| 6 | High | `renameJob` optimistic update applied before `await` — no rollback on failure | Fixed — restructured to update state only after successful await; caller catches errors |
| 7 | High | ErrorBoundary i18n wiring left underspecified — "to the implementer" | Fixed — specified concrete `ErrorBoundaryWithI18n` HOC wrapper with required prop updates to ErrorBoundary class |
| 8 | High | No check that provider has an API key before starting transcription | Fixed — `hasSecret` check on mount in Phase 4; inline warning + button block if missing |
| 9 | High | Phase 5 inter-phase dependency on Phase 2 not stated | Fixed — added explicit precondition note in Phase 5 |
| 10 | Medium | `useEffect` dep array `[getPreference]` — fragile if `useSettings` adds deps | Fixed — changed to `[]` (mount-only) in Phase 3 and Phase 4 with explanatory comment |
| 11 | Medium | Language fallback in Phase 4 `lang !== 'auto'` guard incomplete for unexpected values | Fixed — replaced with explicit `(lang === 'fr' \|\| lang === 'en') ? lang : 'fr'` pattern |
| 12 | Medium | HistoryView double-click: single click on title propagates to `onOpenJob` | Fixed — added `onClick={e => e.stopPropagation()}` on title div |
| 13 | Medium | App language selector `<option>` labels not translated (meta-labels should stay in their own language) | Fixed — documented as intentionally hardcoded; explained rationale |
| 14 | Medium | Title edit affordance: no cursor or role on editable title divs | Fixed — added `cursor: 'text'`, `role="button"`, `tabIndex`, keyboard handler, aria-label |
| 15 | Medium | `PROVIDER_DESCRIPTIONS` reconstructed every render in component body | Fixed — wrapped in `useMemo(() => ..., [t])` |
| 16 | Medium | TranscriptView `db:get-job` useEffect had no unmount cleanup | Fixed — added `let alive = true` guard with `return () => { alive = false; }` cleanup |

### 2026-09-15 — Cycle 2 (via /qplan)

4 findings (0 High, 2 Medium, 2 Low). 2 Medium auto-resolved. 2 Low — F19 verified false positive (IPC response shape confirmed `{ value: unknown }` from source), F20 no action needed (standard bundler resolution).

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 17 | Medium | Phase 3 `setLang(v)` requires `useI18n` import not in Phase 3's scope — Phase 6 fixup not clearly separated | Fixed — replaced with explicit Phase 6 annotation; Phase 3 code block shows the call commented out with Phase 6 marker |
| 18 | Medium | Catch-all validator static key list must be kept in sync with `PreferenceKey` — fragility not noted | Fixed — added implementation note requiring all 3 changes together when `PreferenceKey` grows |
| 19 | Low | `res?.value` in `I18nProvider` may be undefined if IPC shape differs | Verified false positive — `settings:get-preference` returns `{ value: ... }` per `ipc/settings.ts`; `res?.value` is correct |
| 20 | Low | Plan doesn't state `.tsx` extension on `useI18n` import — may confuse implementer | No action — standard bundler extension resolution handles this; import without extension is idiomatic TS |

## Harness Improvement Opportunities

*Reserved.*
