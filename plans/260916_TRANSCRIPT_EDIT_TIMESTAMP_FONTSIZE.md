# Transcript Edit, Timestamp Toggle, Font Size

> **Date**: 2026-09-16
> **Status**: Exploring  <!-- Status grammar: shared/skills/qplan/TEMPLATES.md § Status Grammar -->
> **Scope**: Three user-facing features: inline transcript text editing with reset, copy/export without timestamp preference, app-wide font size preference

---

## Intent

### Problem statement & desired outcomes

Users need three new capabilities in the transcript view and settings:

1. **Inline transcript text editing**: the transcribed text of any turn can be corrected by clicking on it. A "Reset transcript" button restores all turns to their original provider-transcribed text. This addresses the core pain point that AI transcription errors are permanent and uncorrectable.

2. **Copy/Export without timestamp**: a persistent preference that controls whether the `[HH:MM:SS]` prefix is included in copied or exported transcript text. Some workflows (pasting into documents, summarization) don't want timestamps.

3. **App-wide font size**: an accessibility preference (Small/Medium/Large/XL/XXL → 14/16/18/20px) that scales the entire app via the `body` font-size CSS variable. Medium (14px) is the default, matching current behavior.

### Success criteria

1. Single-clicking a transcript turn's text places a cursor in an auto-sized textarea; editing and blurring (or pressing Escape to cancel) persists or discards the change.
2. A "Reset transcript" button in the TranscriptView header is disabled when no turns have been edited; clicking it restores all turns to their original provider text.
3. Original provider text is preserved in a new `original_text` column — it is set once at transcript save time and never overwritten.
4. A toggle in Settings controls `includeTimestamps` (default: on). Both Export and Copy respect it. Existing behavior (timestamps included) is preserved for all existing users.
5. A select in Settings controls font size. Changing it immediately rescales the whole UI (no reload). The preference persists across sessions.
6. `npm test` passes with all new behavior covered in existing test files (no new test files).

### Scope boundaries & non-goals

**In scope:**
- `transcript_turns` schema migration: add `original_text TEXT NOT NULL DEFAULT ''`, backfill from `text`
- New IPC channels: `db:update-turn-text`, `db:reset-transcript`
- New preference keys: `includeTimestamps: boolean` (default `true`), `fontSize: number` (default `14`)
- `SpeakerTurnItem` — click-to-textarea for text editing, hover reset icon removed (reset is header-level)
- `TranscriptView` — Reset button in header
- `SettingsView` — timestamp toggle card, font size select card
- `export.ts` — `formatTranscript` accepts `includeTimestamps` parameter
- CSS — `--font-size-base` variable on `:root`, body and turn-text use it

**Out of scope:**
- Undo/redo for text edits
- Per-turn reset (reset is all-or-nothing via the header button)
- Bulk re-export after timestamp setting change (user triggers export manually)
- Font size affecting only the transcript pane (it is app-wide by design)

---

## Exploration Discovery

<!-- Transient: /qplan folds these into the planning sections and removes this section. -->

### 4. Existing patterns & constraints

- **Preference change surface** (all 5 locations must be updated for each new key): `src/shared/ipc-types.ts` (`Preferences` interface + `PreferenceKey` union), `src/main/settings/store.ts` (`DEFAULT_PREFERENCES`), `src/main/ipc/settings.ts` (validation `else-if` chain + catch-all key list at line 34), `src/renderer/views/SettingsView.tsx` (new card + state), `src/renderer/i18n.ts` (new keys in both `en` and `fr`). Prior art: `plans/done/260915-2102_SETTINGS_PROVIDER_LANGUAGE_TITLE_I18N.md` documents this exact pattern for `defaultProvider`/`appLanguage`.
- **DB migration pattern**: big bang, no backward compatibility. Replace `MIGRATION_001` in `src/main/db/index.ts` with a new schema that includes `original_text TEXT NOT NULL` in `transcript_turns` from the start. Existing DB files are incompatible and will be wiped (acceptable — dev-only data, no production users). No `ALTER TABLE`, no backfill, no `MIGRATION_002`.
- **IPC handler registration**: `src/main/ipc/db.ts` registers handlers; `src/main/ipc/index.ts` calls `registerDbHandlers()` — no change to `index.ts` needed.
- **Speaker-rename as precedent** for optimistic-update pattern: `useTranscript.ts:37-41` calls `await invoke(...)` then updates state. Same pattern for `updateTurnText`.
- **`formatTranscript` is private** in `src/main/ipc/export.ts` — safe to change its signature without breaking any external caller.
- **`transcript-view.test.ts`** reimplements `formatTime` and the format logic inline (lines 4–24, 52–67) — it cannot import from `export.ts` without Electron mocks. Keep the inline reimplementation; add a `false` path to the existing `transcript text formatting` describe block.
- **CSS variable pattern**: the codebase already uses `var()` extensively for colors and spacing in `global.css`. Adding `--font-size-base: 14px` to `:root` follows the established pattern.
- **`App.tsx` mount effect**: `App.tsx` has no preference-loading logic currently. A `useEffect` on mount to read `fontSize` and set the CSS variable is the correct placement. The `SettingsView` font-size change handler must also call `document.documentElement.style.setProperty` immediately so the change is visible without reload.
- **`TranscriptTurn` type** (`src/shared/ipc-types.ts:20–28`): adding `original_text: string` here means all IPC channels carrying `TranscriptTurn[]` automatically include it.

### 5. Risks & mitigations

- **DB migration — big bang, no backward compatibility**: `MIGRATION_001` is replaced in-place with a new schema that includes `original_text TEXT NOT NULL` in `transcript_turns`. Existing `db.sqlite` files in userData are incompatible; users must delete them. Acceptable: no production users, dev data only. No `ALTER TABLE`, no backfill, no migration versioning needed.
- **Catch-all key list in `settings:set-preference` handler** (`settings.ts:34`): this list must be updated for both new keys or writes will be silently rejected. Easy to miss — it is the #1 risk for the preference features.
- **Font size CSS variable timing**: if `App.tsx` reads the preference asynchronously on mount, there will be a brief flash at the default 14px before the user's saved size applies. Mitigation: 14px is the default and the minimum, so any flash will be invisible or imperceptible (it can only flash at the smaller size before scaling up — and since 14px is the minimum, there is no flash at all).
- **Textarea auto-height**: a `<textarea>` that auto-sizes to content requires a `useEffect` to set `height: auto` then `height: scrollHeight`. This is a known pattern but needs care to avoid infinite resize loops.

### 6. Resolved decisions

- Change-1: Turn text edit trigger — A: double-click — Decision: **single-click** (user revised: single-click places cursor directly; double-click kept for speaker rename and title only)
- Change-1a: Edit control type — A: textarea — Decision: `<textarea>`, auto-sized to content height
- Change-1b: Commit trigger — A: blur commits, Escape cancels — Decision: blur commits, Escape cancels (Enter inserts newline naturally in textarea)
- Change-1c: Reset target — A: original provider text (option A) — Decision: add `original_text` column, populated at `saveTranscript`, never overwritten; reset restores to that value
- Change-1d: Edit implementation — A: click-to-textarea — Decision: replace `turn-text` span with auto-sized textarea on single-click
- Change-1e: Reset button placement — A: header-level "Reset transcript" button (option B) — Decision: single button in TranscriptView header
- Change-1f: Reset button enabled state — A: disabled when no edits — Decision: disabled when `turns.every(t => t.text === t.original_text)`
- Change-2a: `formatTranscript` implementation — A: pass as parameter — Decision: `formatTranscript(jobId, includeTimestamps: boolean)`; callers read `readPreferences().includeTimestamps` at handler time
- Change-3a: Font size scope — A: app-wide — Decision: `--font-size-base` on `:root` drives `body` font-size; this is an accessibility setting
- Change-3b: Font size control type — A: named-size select — Decision: select with named options
- Change-3c/d: Font size options — A: Medium=14 (default), Large=16, XL=18, XXL=20 — Decision: confirmed, minimum is Medium (no smaller option)

### 7. Open items

- **i18n strings**: French translations for the new setting labels (`includeTimestamps` toggle label, font size select label, reset button label) are not determined. Must be confirmed during implementation.
- **`db:reset-transcript` return shape**: proposed to return `TranscriptTurn[]` (the reset rows) so the renderer can update state in one IPC round-trip. Confirm during implementation that the response shape matches `useTranscript`'s state update pattern.

### 8. Recommended approach

Three largely sequential phases:

**Phase 1 — DB schema update + transcript text editing**
1. Replace `MIGRATION_001` in `db/index.ts` with updated schema: add `original_text TEXT NOT NULL` to `transcript_turns`. Delete local `db.sqlite` to force re-creation.
2. Add `original_text: string` to `TranscriptTurn` in `ipc-types.ts`.
3. Update `saveTranscript` in `db/transcript.ts` to write `original_text` from the incoming turn's `text`.
4. Add `updateTurnText(id, text)` and `resetTranscript(jobId)` to `db/transcript.ts`.
5. Register `db:update-turn-text` and `db:reset-transcript` IPC handlers in `db.ts`.
6. Add `updateTurnText` and `resetTranscript` to `useTranscript` hook.
7. Update `SpeakerTurnItem`: replace `turn-text` span with click-to-textarea (auto-sized, blur commits, Escape cancels).
8. Add Reset button to `TranscriptView` header, disabled when no edits.
9. Update `db.test.ts`: add `updateTurnText` and `resetTranscript` test cases.

**Phase 2 — Copy/Export without timestamp preference**
1. Add `includeTimestamps: boolean` to `Preferences` + `PreferenceKey` in `ipc-types.ts`.
2. Add default (`true`) to `DEFAULT_PREFERENCES` in `store.ts`.
3. Add validation block + catch-all list update in `settings.ts`.
4. Update `formatTranscript` signature and both callers in `export.ts`.
5. Add toggle card to `SettingsView`.
6. Add i18n keys.
7. Update `settings.test.ts` (new default assertion). Update `transcript-view.test.ts` (add timestamp-false path).

**Phase 3 — Font size preference**
1. Add `fontSize: number` to `Preferences` + `PreferenceKey`.
2. Add default (`14`) to `DEFAULT_PREFERENCES`.
3. Add validation (must be one of `[14, 16, 18, 20]`) in `settings.ts`.
4. Add `--font-size-base: 14px` to `:root` in `global.css`; update `body` and `.turn-text` to use it.
5. Add `useEffect` in `App.tsx` to load `fontSize` on mount and set the CSS variable.
6. Add font size select card to `SettingsView` (also updates CSS variable immediately on change).
7. Add i18n keys.
8. Update `settings.test.ts`.

### 9. QA environment

- **Runtime**: `npm run dev` starts the Electron app in development mode. All three features are testable end-to-end: open a completed transcript from History, click turn text to edit, use the Reset button, check Settings for the new preference cards, verify Export/Copy output.
- **Test suite**: `npm test` rebuilds `better-sqlite3` for Node and runs Vitest. Unit tests in `tests/unit/` cover DB, settings, and format logic.
- **No external credentials required** for QA of these features — they are local-only (DB, CSS, export).
