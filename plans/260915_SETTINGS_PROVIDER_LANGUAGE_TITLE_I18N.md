# Settings: Provider, Language, Title Editing & UI Language

> **Date**: 2026-09-15
> **Status**: Exploring
> **Scope**: 4 features — provider global setting, default language preference, post-transcription title editing, FR/EN UI language

---

## Intent

### Problem statement & desired outcomes

Four improvements to the app's settings and post-transcription UX:

1. **Provider in settings** — provider selection is currently per-form local state in RecordView and UploadView, defaulting to AssemblyAI with no memory. Moving it to a global preference removes redundant dropdowns and lets the user configure their provider once.

2. **Default transcription language** — `defaultLanguage` already exists as a preference key but is never surfaced in SettingsView and defaults to `'auto'`. Users primarily transcribing in French should have French pre-selected without touching the form every time.

3. **Editable job title** — the title assigned at recording/upload time cannot be changed after the fact. Users need to rename jobs from the TranscriptView (immediately after transcription) and from HistoryView (when browsing old jobs).

4. **UI language** — the entire app UI is hardcoded English. A French/English language toggle in Settings lets French-speaking users use the app in their language.

### Success criteria

- SC1 (Provider setting): A `defaultProvider` preference exists in SettingsView. Provider dropdowns are removed from RecordView and UploadView. All transcription jobs use the provider from Settings.
- SC2 (Default language): `defaultLanguage` is surfaced in SettingsView with `'fr'` as the stored default. RecordView and UploadView language dropdowns initialize from this preference.
- SC3 (Title editing): Double-click a job title in TranscriptView or HistoryView to rename it inline. Changes persist to the `jobs` table. TranscriptView displays the current job title as its heading.
- SC4 (UI language): An `appLanguage` preference (`'fr'` | `'en'`) is in SettingsView. Selecting French translates all ~50 renderer UI strings. Selecting English restores English. Default stored preference is French; in-memory default (first render) is English to avoid async flicker.
- SC5 (Tests): `tests/unit/settings.test.ts:77` updated to assert `defaultLanguage === 'fr'`. New `updateJobTitle` test added to `db.test.ts`.

### Scope boundaries & non-goals

- In scope: all 4 features above, unit test updates.
- Out of scope: system audio capture, chunk_count correctness, per-job provider override after moving provider to settings, translating progress log lines from the main process (`'Preparing audio...'`, `'Transcribing chunk N...'` etc.), any new npm i18n library.
- The `'auto'` value for `defaultLanguage` remains valid in the type and validator; SettingsView only offers `fr`/`en`. A stored `'auto'` value is treated as `'fr'` in the UI display.

---

## Exploration Discovery

<!-- Transient: /qplan folds these into the planning sections and removes this section. -->

### 4. Existing patterns & constraints

- **`IpcChannels` is the canonical channel registry** (`src/shared/ipc-types.ts:33`). Comment: "ALL IPC channels declared here. Never use string literals elsewhere." Every new IPC channel must be declared there; `InvokeChannel = keyof IpcChannels` enforces this at compile time.
- **`Preferences` interface and `PreferenceKey` union** (`ipc-types.ts:224,227-230`): currently `'recordingsFolder' | 'defaultLanguage'`. Both `defaultProvider` and `appLanguage` must be added to both.
- **`settings:set-preference` validation** (`ipc/settings.ts:33-35`): each preference key has a hard-coded validation block; new keys require new blocks or arbitrary values persist silently.
- **`DEFAULT_PREFERENCES`** (`store.ts:15-18`): the TypeScript type requires completeness — missing a new `Preferences` field is a compile error.
- **No React context providers exist** in the app (`App.tsx` only wraps `<ErrorBoundary>`). The i18n context will be the first.
- **`SpeakerLabel.tsx`** implements inline double-click-to-edit (Enter/blur commit, Escape cancel) — the exact pattern for title editing.
- **`useHistory` exposes `refresh()`** (`hooks/useHistory.ts:11`) and local `jobs` state. Optimistic title update means mutating the local state without re-fetching.
- **Migration SQL is embedded** in `db/index.ts` as a string constant AND lives on disk at `src/main/db/migrations/001_initial.sql`. The test suite reads the disk copy (`db.test.ts`). Title editing needs no schema change (`title TEXT NOT NULL` already exists). If any other schema change were needed, both copies would need updating.
- **`settings.test.ts:77`** asserts `expect(prefs.defaultLanguage).toBe('auto')` — will fail once the default changes to `'fr'`.
- **`setPreference` uses plain `writeFileSync`** (no atomic write), unlike `writeSecrets` which uses `.tmp`+`renameSync`. New preferences follow the existing plain-write pattern.
- **`'Done'`, `'Error:'`, `'Cancelled'`** are pattern-matched in `JobProgressView.tsx:22-23` to drive navigation to TranscriptView or failed state. These strings originate from `runner.ts` via `sendProgress()` and must not be translated or mapped.

### 5. Risks & mitigations

- **Risk**: `'auto'` stored as `defaultLanguage` pre-exists in some users' `preferences.json`. The SettingsView language selector only offers `'fr'`/`'en'`; a stored `'auto'` would render with no option selected.
  **Mitigation**: treat `'auto'` as `'fr'` in the SettingsView dropdown display only (fallback the selector value to `'fr'` when the stored value is `'auto'`). The stored value is only overwritten when the user explicitly saves.

- **Risk**: Brief English-to-French flash on first launch. In-memory default is English; stored default is French. The async preference IPC call is local (sub-millisecond) but still async.
  **Mitigation**: Acceptable in practice — the flash is imperceptible. User confirmed this approach.

- **Risk**: `runner.ts` mock in `tests/unit/runner.test.ts` destructures only the exports it cares about from `../../src/main/db/jobs`. Adding `updateJobTitle` to the real module won't break the runner test as long as runner.ts itself doesn't call `updateJobTitle`.
  **Mitigation**: `updateJobTitle` is never called from `runner.ts`; no mock update needed.

- **Risk**: `RecordView` and `UploadView` removing the provider dropdown means provider must be set in Settings before any transcription. If `defaultProvider` preference is not yet set (brand-new install), the fallback must be a sensible value.
  **Mitigation**: `DEFAULT_PREFERENCES.defaultProvider = 'assemblyai'` — same as the current hardcoded value, so first-launch behavior is unchanged.

### 6. Resolved decisions

- Change-1: Should provider become a global-only setting (dropdown removed from views) or a default that views can override per-job? — A: Option B (global only) — Decision: provider dropdowns removed from RecordView and UploadView; provider always read from `defaultProvider` preference.
- Change-2: Should language be a global-only setting or a per-job overridable default? — A: Option A (per-job default) — Decision: language dropdown stays in RecordView and UploadView, initialized from `defaultLanguage` preference (default `'fr'`).
- Change-3a: Should TranscriptView load its own job via `db:get-job` or have `App.tsx` pass `job.title` as a prop? — A: `db:get-job` in TranscriptView — Decision: TranscriptView calls `db:get-job` on mount to get title; no prop threading through App.tsx.
- Change-3b: After title edit in HistoryView, optimistic local update or full refresh? — A: Optimistic — Decision: mutate the local `jobs` state array in place after a successful `db:update-job-title` call.
- Change-4a: In-memory i18n default English (first render English, stored preference French)? — A: Yes, default in-memory to English; stored preference defaults to French — Decision: `appLanguage` context initializes to `'en'`; async preference load switches to `'fr'` on first launch (and subsequent launches until user changes it).
- Change-4b: Translate provider descriptions and ErrorBoundary? Translate progress log lines? — A: Translate provider descriptions and ErrorBoundary; leave progress log lines untranslated — Decision: all renderer-side UI strings translated except progress log output from main process.
- Change-4c: Translate transcription language dropdown labels (`Auto-detect`, `French`, `English`)? — A: Yes — Decision: language option labels follow app UI language.

### 7. Open items

- None. All design decisions resolved.

### 8. Recommended approach

**Phase 1 — Preferences groundwork (types + store + IPC)**
- Add `defaultProvider: ProviderName` and `appLanguage: 'fr' | 'en'` to `PreferenceKey`, `Preferences`, and `DEFAULT_PREFERENCES` (`defaultProvider: 'assemblyai'`, `appLanguage: 'fr'`).
- Add validation blocks in `ipc/settings.ts` `settings:set-preference` handler for both new keys.
- Change `DEFAULT_PREFERENCES.defaultLanguage` from `'auto'` to `'fr'`.
- Update `settings.test.ts:77` to assert `'fr'`.

**Phase 2 — DB: title update**
- Add `updateJobTitle(id: string, title: string): void` to `db/jobs.ts`.
- Add `'db:update-job-title': { request: { id: string; title: string }; response: void }` to `IpcChannels` in `ipc-types.ts`.
- Register the handler in `ipc/db.ts`.
- Add test in `db.test.ts`.

**Phase 3 — SettingsView: new preferences UI**
- Add a "Transcription" section: `defaultProvider` selector (all 4 providers), `defaultLanguage` selector (`fr`/`en`, showing `'auto'` fallback as `'fr'`).
- Add an "App language" section: `appLanguage` selector (`fr`/`en`).
- Wire `getPreference`/`setPreference` from `useSettings()` in SettingsView on mount.

**Phase 4 — RecordView/UploadView: remove provider dropdown, hydrate language**
- Remove provider `<select>` from both views; read `defaultProvider` from `getPreference` on mount.
- Initialize language dropdown from `getPreference('defaultLanguage')` on mount.

**Phase 5 — Title editing**
- TranscriptView: call `db:get-job` on mount to get `job.title`; display as editable heading using the SpeakerLabel inline-edit pattern.
- HistoryView: wrap `job-title` div in the same inline-edit pattern; on commit call `db:update-job-title` and optimistically update local `jobs` state.

**Phase 6 — i18n context and string extraction**
- Create `src/renderer/i18n.ts` with `en` and `fr` string maps covering all ~50 translatable strings.
- Create `I18nContext` and `useI18n()` hook in `src/renderer/hooks/useI18n.ts`.
- Wrap `<App>` in `<I18nProvider>` in `main.tsx`; load `appLanguage` preference asynchronously and update context.
- Replace hardcoded strings in all 7 components with `t('key')` calls.

### 9. QA environment

- `npm run dev` starts Electron in development mode.
- `npm test` runs Vitest unit tests (note: rebuilds `better-sqlite3` for Node before running).
- Manual verification in the running app: Settings page for all new preference controls; RecordView and UploadView for removed provider dropdown and language initialization; TranscriptView title heading + inline edit; HistoryView title inline edit; language toggle in Settings and verify all UI strings change.
- No external API keys needed for preferences/title/i18n testing; API key tests require real keys or mocks.
