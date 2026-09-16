# Transcript Edit, Timestamp Toggle, Font Size

> **Date**: 2026-09-16
> **Status**: In Progress  <!-- Status grammar: shared/skills/qplan/TEMPLATES.md § Status Grammar -->
> **Last Updated**: <set by /qclose at archival>
> **Scope**: Three user-facing features: inline transcript text editing with reset, copy/export without timestamp preference, app-wide font size preference
> **Estimated effort**: 1-2 days

---

## Intent

### Problem statement & desired outcomes

Users need three new capabilities in the transcript view and settings:

1. **Inline transcript text editing**: the transcribed text of any turn can be corrected by double-clicking on it. A "Reset transcript" button (with confirmation) restores all turns to their original provider-transcribed text. This addresses the core pain point that AI transcription errors are permanent and uncorrectable.

2. **Copy/Export without timestamp**: a persistent preference that controls whether the `[HH:MM:SS]` prefix is included in copied or exported transcript text. Some workflows (pasting into documents, summarization) don't want timestamps.

3. **App-wide font size**: an accessibility preference (Medium/Large/XL/XXL → 14/16/18/20px) that scales the entire app via the `body` font-size CSS variable. Medium (14px) is the default, matching current behavior.

### Success criteria

- SC-1: Double-clicking a transcript turn's text places a cursor in an auto-sized textarea; blurring commits the change; Escape cancels (restores last committed text); blank text on blur restores the previous non-empty text (no empty turns).
- SC-2: A "Reset transcript" button in the TranscriptView header is disabled when no turns have been edited; clicking it shows a confirmation prompt; confirming restores all turns to `original_text`.
- SC-3: `original_text TEXT NOT NULL` exists in `transcript_turns` schema; it is populated at `saveTranscript` time (copied from `text`) and never overwritten by any subsequent operation.
- SC-4: A toggle in Settings controls `includeTimestamps` (default: `true`). Both Export-to-file and Copy-to-clipboard respect it. Existing behavior (timestamps on) is preserved by default.
- SC-5: A select in Settings controls font size (Medium/Large/XL/XXL). Changing it immediately rescales the whole UI without reload; the preference persists across sessions.
- SC-6: `npm test` passes with updated coverage in existing test files (no new test files created).

### Scope boundaries & non-goals

**In scope:**
- `transcript_turns` schema: big-bang replacement adding `original_text TEXT NOT NULL`
- New IPC channels: `db:update-turn-text`, `db:reset-transcript`
- New preference keys: `includeTimestamps: boolean`, `fontSize: number`
- `SpeakerTurnItem` — double-click-to-textarea for text editing; edited-turn visual indicator
- `TranscriptView` — "Reset transcript" button in header with confirmation
- `SettingsView` — timestamp toggle card, font size select card
- `export.ts` — extract pure `formatLine` helper; `formatTranscript` accepts `includeTimestamps` parameter
- CSS — `--font-size-base` CSS variable on `:root`; `body`, `.turn-text`, `.turn-text-editor`, sidebar font sizes use it
- `App.tsx` — font-size preference loaded on mount, CSS variable applied

**Out of scope:**
- Undo/redo for text edits
- Per-turn reset (reset is all-or-nothing)
- Bulk re-export after timestamp setting change
- Font size affecting only the transcript pane

---

## 1) Current State

- **`transcript_turns` schema** (`src/main/db/index.ts` — `MIGRATION_001` string, and canonical copy in `src/main/db/migrations/001_initial.sql`): `id, job_id, chunk_index, speaker_label, start_ms, end_ms, text`. No `original_text` column. No `UPDATE` path for `text` exists anywhere.
- **`TranscriptTurn` type** (`src/shared/ipc-types.ts` — `interface TranscriptTurn`): 7 fields, no `original_text`.
- **`SpeakerTurnItem`** (`src/renderer/components/SpeakerTurnItem.tsx`): `turn-text` span is read-only with `user-select: text` but no click handler.
- **`formatTranscript`** (`src/main/ipc/export.ts` — `function formatTranscript`): private, hardcodes `${formatTime(t.start_ms)} ${name}: ${t.text}` per line. Called by both `export:to-file` and `export:to-clipboard` handlers.
- **Preferences** (`src/shared/ipc-types.ts` — `PreferenceKey` union and `Preferences` interface): 4 keys. The `settings:set-preference` IPC handler (`src/main/ipc/settings.ts` — `else-if` chain ending in catch-all list at the final `else if (![...].includes(key))` guard) must be updated for every new key.
- **CSS** (`src/renderer/styles/global.css`): `body { font-size: 14px }`, `.turn-text { font-size: 13px }`, `.sidebar-item { font-size: 13px }`, `.sidebar-section-label { font-size: 10px }` — all hardcoded. No `--font-size-base` variable.
- **`App.tsx`** (`src/renderer/App.tsx`): no preference-loading on mount.
- **Preload** (`src/preload/index.ts`): uses `InvokeChannel` type derived from `IpcChannels` — new channels added to `IpcChannels` are automatically reachable from the renderer with no manual preload update needed.
- **Tests**: `tests/unit/db.test.ts` has fixtures at the `saveTranscript` call site (`cascade` test at line ~120 and `batch insert of 1000 turns` test at line ~177) that pass turn objects without `original_text` — these will break once the column is `NOT NULL`.

## 2) Goal

Add double-click turn-text editing with original-text reset (confirmed), `includeTimestamps` export preference, and app-wide `fontSize` accessibility preference — all wired through the existing IPC/preferences/CSS infrastructure with no new test files.

## 3) Design Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| DB migration strategy | Big-bang: replace `MIGRATION_001` in-place and update `001_initial.sql`; delete `db.sqlite` from userData | ALTER TABLE + backfill | No production users; dev data only. Simpler, no migration versioning needed. |
| Edit trigger for turn text | Double-click on `turn-text` span | Single-click (original exploration decision) | Single-click conflicts with `user-select: text` — users cannot copy text without entering edit mode. Double-click is consistent with title and speaker-name patterns in the app. Supersedes exploration decision Change-1. |
| Edit control | `<textarea>` auto-sized to content height via `useEffect` (`height: auto` then `scrollHeight`) | `contenteditable` div | `contenteditable` returns HTML requiring sanitization; textarea is fully controlled and consistent with project patterns. |
| Edit commit / cancel | Blur commits if text non-empty; blank-on-blur restores prior `turn.text` (no empty turns). Escape cancels current unsaved edit (restores last committed `turn.text`). Enter inserts newline. | Enter-to-commit | Transcript text is prose; Enter-to-newline is natural. Empty turns are disallowed to avoid orphan records. |
| `draft` state sync | `useEffect(() => { setDraft(turn.text); }, [turn.text])` inside `SpeakerTurnItem` keeps draft in sync with prop updates (e.g. after reset) | Initialize once on mount | Required so that a reset followed immediately by a double-click opens the textarea with the correct (reset) text. |
| `updateTurnText` update strategy | Await IPC call, then update state on success; on failure, re-throw and let existing `error` state pattern handle it | Optimistic (update before await) | DB write failure must not leave UI showing unsaved text. Follows reliability contract established for this hook. |
| `resetTranscript` SQL | Wrap `UPDATE + SELECT` in a `db.transaction()` | Two separate statements | Atomic: if app crashes between UPDATE and SELECT, the DB is consistent and the next load will show the reset text. |
| Reset confirmation | `window.confirm(t('transcript_reset_confirm'))` before executing reset | Immediate reset; two-step button | Prevents accidental data loss on a long transcript. Reviewed High finding H8. |
| Reset button state | Disabled when `turns.every(t => t.text === t.original_text)` | Always enabled | Visual feedback that edits exist; prevents accidental resets on unedited transcripts. |
| Edited-turn visual indicator | Left-border accent (`border-left: 2px solid var(--accent)`) on `.speaker-turn` when `turn.text !== turn.original_text` | No indicator; dot badge | Subtle, non-distracting, removes on reset. Allows user to see which turns have been corrected at a glance. |
| `db:reset-transcript` return | Returns `TranscriptTurn[]` (all reset turns) | Returns void + re-fetch | Single IPC round-trip; `useTranscript.resetTranscript` calls `setTurns(resetTurns)` directly. |
| `formatTranscript` / testability | Extract `formatLine(name, startMs, text, includeTimestamps)` as an exported pure function from `export.ts`; `formatTranscript(jobId, includeTimestamps)` uses it | Keep inline (tautological test) | `transcript-view.test.ts` calls the real `formatLine` function — no mock needed, genuine regression protection. |
| Font size options | Named select: Medium=14, Large=16, XL=18, XXL=20. Default: Medium (14). No option smaller than Medium. | Free-range slider | Consistent result set; easy to localize; 14px is current default and minimum. |
| Font size CSS mechanism | `--font-size-base` on `:root`; `body`, `.turn-text`, `.turn-text-editor`, `.sidebar-item` use it; `.sidebar-section-label` and `.sidebar-brand-sub` use smaller offsets | Inline style threading | Single CSS variable; scales sidebar + transcript + buttons consistently. Sidebar items are included so XXL doesn't produce a mismatched layout. |
| Font size application point | `useEffect` in `App.tsx` on mount with `alive` guard; re-applied immediately on change in `SettingsView` | `main.tsx` | `App.tsx` is the top-level component. No startup flash: 14px is the default and minimum so any async delay only causes scaling up — imperceptible at 14px start. |
| `includeTimestamps` toggle UI | Styled label+checkbox row using existing `.form-group`/`.form-label` classes | Raw `<input type="checkbox">` | Consistent with the design system; avoids unstyled browser checkbox. |
| `includeTimestamps` default | `true` | `false` | Preserves current behavior for all existing users. |
| `fontSize` IPC validation | Accept only values in `[14, 16, 18, 20]` | Accept any number ≥ 14 | Closed set matches UI options; rejects stale/corrupt values. |

## 4) External Dependencies & Costs

### Required external changes

None. All changes are local (DB, IPC, renderer, CSS).

### Cost impact

None.

## 5) Implementation Phases

### Phase 1: DB schema + transcript text editing [QA]

**Goal**: Add `original_text` to the schema, wire the full text-edit and reset flow end-to-end.

**Covers**: SC-1, SC-2, SC-3

**File scope**: `src/main/db/index.ts`, `src/main/db/migrations/001_initial.sql`, `src/main/db/transcript.ts`, `src/shared/ipc-types.ts`, `src/main/ipc/db.ts`, `src/renderer/hooks/useTranscript.ts`, `src/renderer/components/SpeakerTurnItem.tsx`, `src/renderer/views/TranscriptView.tsx`, `src/renderer/styles/global.css`, `src/renderer/i18n.ts`, `tests/unit/db.test.ts`

**Changes:**

**`src/main/db/migrations/001_initial.sql`** — add `original_text TEXT NOT NULL` to the `transcript_turns` table definition (after `text TEXT NOT NULL`):

```sql
CREATE TABLE IF NOT EXISTS transcript_turns (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  speaker_label TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  original_text TEXT NOT NULL
);
```

**`src/main/db/index.ts`** — update the `transcript_turns` block inside the `MIGRATION_001` string literal to match the `.sql` file above (identical change — both must stay in sync).

Note: the dev `db.sqlite` in `app.getPath('userData')` must be deleted manually after this change to force schema re-creation. The `CREATE TABLE IF NOT EXISTS` guard means an existing DB is NOT updated automatically — the big-bang approach requires the old file to be removed.

**`src/shared/ipc-types.ts`** — add `original_text: string` to `TranscriptTurn` (after `text`). Add two new IPC channel declarations after the `'db:get-speaker-mappings'` block:

```ts
'db:update-turn-text': {
  request: { id: string; text: string };
  response: void;
};
'db:reset-transcript': {
  request: { job_id: string };
  response: TranscriptTurn[];
};
```

**`src/main/db/transcript.ts`** — update `saveTranscript` INSERT to include `original_text`. Use a named parameter mapped to the turn's `text` field (not a new field on `TranscriptTurn` — the mapping happens in the SQL):

```ts
const stmt = db.prepare(`
  INSERT INTO transcript_turns
    (id, job_id, chunk_index, speaker_label, start_ms, end_ms, text, original_text)
  VALUES
    (@id, @job_id, @chunk_index, @speaker_label, @start_ms, @end_ms, @text, @text)
`);
```

Note: better-sqlite3 named parameters bind by object property name. Since `original_text` is not a property on `TranscriptTurn`, using `@text` twice in the SQL resolves both positions from `turn.text`. This is the correct pattern.

Add two new exported functions after `getSpeakerMappings`:

```ts
export function updateTurnText(id: string, text: string): void {
  const db = getDb();
  db.prepare('UPDATE transcript_turns SET text = @text WHERE id = @id').run({ text, id });
}

export function resetTranscript(job_id: string): TranscriptTurn[] {
  const db = getDb();
  const reset = db.transaction(() => {
    db.prepare('UPDATE transcript_turns SET text = original_text WHERE job_id = @job_id').run({ job_id });
    return db.prepare(
      'SELECT * FROM transcript_turns WHERE job_id = ? ORDER BY start_ms ASC'
    ).all(job_id) as TranscriptTurn[];
  });
  return reset();
}
```

**`src/main/ipc/db.ts`** — register two new handlers at the end of `registerDbHandlers`:

```ts
ipcMain.handle('db:update-turn-text', (_event, { id, text }: { id: string; text: string }) => {
  transcript.updateTurnText(id, text);
});

ipcMain.handle('db:reset-transcript', (_event, { job_id }: { job_id: string }) => {
  return transcript.resetTranscript(job_id);
});
```

**`src/renderer/hooks/useTranscript.ts`** — add `updateTurnText` and `resetTranscript` alongside `renameSpeaker`. Pattern: await IPC, then update state on success (no optimistic update):

```ts
const updateTurnText = useCallback(async (id: string, text: string) => {
  if (!jobId) return;
  await window.electronAPI.invoke('db:update-turn-text', { id, text });
  setTurns(prev => prev.map(t => t.id === id ? { ...t, text } : t));
}, [jobId]);

const resetTranscript = useCallback(async () => {
  if (!jobId) return;
  const confirmed = window.confirm(/* i18n key resolved at call site */
    'Reset all turns to their original transcribed text? This cannot be undone.'
  );
  if (!confirmed) return;
  const resetTurns = await window.electronAPI.invoke(
    'db:reset-transcript', { job_id: jobId }
  ) as TranscriptTurn[];
  setTurns(resetTurns);
}, [jobId]);
```

Note: The `window.confirm` call moves here from `TranscriptView` so the hook owns the full reset flow. The confirmation message string should come from `useI18n().t('transcript_reset_confirm')` — inject `t` from context or pass it as a parameter. Simplest: call `window.confirm` in `TranscriptView` and pass a `confirmed` boolean to a leaner hook function, or use `window.confirm` inline in the button handler in `TranscriptView` (see below).

Return both from the hook.

**`src/renderer/components/SpeakerTurnItem.tsx`** — add `onEditText` prop; replace `turn-text` span with double-click-to-textarea; add draft sync effect; add edited indicator:

```tsx
interface Props {
  turn: TranscriptTurn;
  displayName: string;
  onRename: (name: string) => void;
  onSeek: (ms: number) => void;
  onEditText: (id: string, text: string) => void;
}

export default function SpeakerTurnItem({ turn, displayName, onRename, onSeek, onEditText }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when turn.text changes externally (e.g. after reset)
  useEffect(() => { setDraft(turn.text); }, [turn.text]);

  // Auto-size textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, draft]);

  const startEdit = () => {
    setDraft(turn.text);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      // Blank on blur: restore to last committed text; do not save empty
      setDraft(turn.text);
      return;
    }
    if (trimmed !== turn.text) onEditText(turn.id, trimmed);
  };

  const isEdited = turn.text !== turn.original_text;

  return (
    <div className={`speaker-turn${isEdited ? ' speaker-turn--edited' : ''}`}>
      {/* timestamp and speaker label unchanged */}
      <span className="turn-time" onClick={() => onSeek(turn.start_ms)} /* ... */ >
        {fmt(turn.start_ms)}
      </span>
      <SpeakerLabel displayName={displayName} onRename={onRename} onSeek={() => onSeek(turn.start_ms)} />
      {editing ? (
        <textarea
          ref={textareaRef}
          className="turn-text-editor"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setDraft(turn.text); } }}
          aria-label="Edit turn text"
        />
      ) : (
        <span
          className="turn-text selectable"
          onDoubleClick={startEdit}
          role="button"
          tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startEdit()}
          aria-label="Edit this turn text"
          title="Double-click to edit"
        >
          {turn.text}
        </span>
      )}
    </div>
  );
}
```

**`src/renderer/styles/global.css`** — add to the Transcript view section:

```css
/* Edited turn indicator */
.speaker-turn--edited {
  border-left: 2px solid var(--accent);
  padding-left: calc(var(--space-3) - 2px); /* compensate for border */
}

/* Turn text editor (textarea) */
.turn-text-editor {
  font-family: var(--font-sans);
  font-size: calc(var(--font-size-base) - 1px); /* uses var — safe with 14px fallback */
  color: var(--text);
  background: var(--surface0);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  outline: none;
  resize: none;
  overflow: hidden;
  flex: 1;
  line-height: 1.6;
  min-height: 24px;
}
```

Note: `font-size: calc(var(--font-size-base) - 1px)` references the CSS variable defined in Phase 3. Until Phase 3 runs, `--font-size-base` is not declared in `:root`, so the browser falls back to the inherited font size (14px from `body`). This is safe: the `calc()` resolves to approximately 13px regardless of whether the variable or the cascade provides the base.

**`src/renderer/views/TranscriptView.tsx`** — wire `updateTurnText` and `resetTranscript`; add Reset button; pass `onEditText` to `SpeakerTurnItem`:

```tsx
const { turns, loading, error, renameSpeaker, getDisplayName, updateTurnText, resetTranscript } = useTranscript(jobId);

const hasEdits = turns.length > 0 && turns.some(t => t.text !== t.original_text);

// In header buttons area:
<button
  className="btn btn-ghost btn-sm"
  onClick={() => {
    if (!window.confirm(t('transcript_reset_confirm'))) return;
    void resetTranscript();
  }}
  disabled={!hasEdits}
  aria-label={t('transcript_reset_confirm_label')}
  title={t('transcript_reset_title')}
>
  {t('transcript_btn_reset')}
</button>
```

Note: confirmation is done inline in the button handler; `resetTranscript` hook function does NOT include `window.confirm` (keeping the hook pure).

Pass `onEditText` to `SpeakerTurnItem`:
```tsx
<SpeakerTurnItem
  key={turn.id}
  turn={turn}
  displayName={getDisplayName(turn.chunk_index, turn.speaker_label)}
  onRename={name => void renameSpeaker(turn.chunk_index, turn.speaker_label, name)}
  onSeek={onSeek}
  onEditText={(id, text) => void updateTurnText(id, text)}
/>
```

**`src/renderer/i18n.ts`** — add to `en` and `fr`:

```ts
// en
transcript_btn_reset: '↩ Reset transcript',
transcript_reset_confirm: 'Reset all turns to original transcribed text? This cannot be undone.',
transcript_reset_confirm_label: 'Confirm reset all turns to original text',
transcript_reset_title: 'Restore all turns to original transcribed text',

// fr
transcript_btn_reset: '↩ Réinitialiser la transcription',
transcript_reset_confirm: 'Réinitialiser toutes les répliques au texte transcrit original ? Cette action est irréversible.',
transcript_reset_confirm_label: 'Confirmer la réinitialisation de toutes les répliques',
transcript_reset_title: 'Restaurer toutes les répliques au texte original',
```

**`tests/unit/db.test.ts`** — fix the two existing fixtures that will break:

1. In the `cascade deletes` test (near `saveTranscript([`): add `original_text: 'Hello'` to the turn object.
2. In the `batch insert of 1000 turns` test (the `Array.from` block): add `original_text: \`Turn ${i} text content\`` to each generated turn object.

Then add two new test cases in the `transcript CRUD` describe block:

```ts
it('updateTurnText updates text but not original_text', async () => {
  const { saveTranscript, getTranscript, updateTurnText } = await import('../../src/main/db/transcript');
  const { createJob } = await import('../../src/main/db/jobs');
  createJob({ id: 'job-edit', title: 'Edit Test', created_at: Date.now(), audio_path: '/tmp/edit.mp3',
    duration_s: null, provider: 'assemblyai' as const, model: 'universal', language: 'fr' as const,
    status: 'pending' as const, error_msg: null, chunk_count: 1 });
  saveTranscript([{ id: 'turn-edit-1', job_id: 'job-edit', chunk_index: 0, speaker_label: 'A',
    start_ms: 0, end_ms: 1000, text: 'Original', original_text: 'Original' }]);
  updateTurnText('turn-edit-1', 'Corrected');
  const [turn] = getTranscript('job-edit');
  expect(turn.text).toBe('Corrected');
  expect(turn.original_text).toBe('Original');
});

it('resetTranscript restores text from original_text for all turns', async () => {
  const { saveTranscript, getTranscript, updateTurnText, resetTranscript } = await import('../../src/main/db/transcript');
  const { createJob } = await import('../../src/main/db/jobs');
  createJob({ id: 'job-reset', title: 'Reset Test', created_at: Date.now(), audio_path: '/tmp/reset.mp3',
    duration_s: null, provider: 'assemblyai' as const, model: 'universal', language: 'fr' as const,
    status: 'pending' as const, error_msg: null, chunk_count: 1 });
  saveTranscript([{ id: 'turn-reset-1', job_id: 'job-reset', chunk_index: 0, speaker_label: 'A',
    start_ms: 0, end_ms: 1000, text: 'Original', original_text: 'Original' }]);
  updateTurnText('turn-reset-1', 'Edited');
  const resetTurns = resetTranscript('job-reset');
  expect(resetTurns[0].text).toBe('Original');
  expect(resetTurns[0].original_text).toBe('Original');
  // Verify DB state matches
  expect(getTranscript('job-reset')[0].text).toBe('Original');
});
```

**Exit criteria**:
- [x] `db.sqlite` deleted from userData; app restarts cleanly with new schema
- [x] `transcript_turns` table includes `original_text TEXT NOT NULL` (confirmed by `updateTurnText` test asserting `original_text === 'Original'` after edit)
- [x] `001_initial.sql` updated to match `MIGRATION_001` string in `index.ts`
- [x] Double-clicking a turn's text opens a textarea pre-populated with current text
- [x] Blurring commits; text persists across view reload (History → reopen transcript)
- [x] Escape cancels and restores last committed text (not `original_text`)
- [x] Blank textarea on blur restores previous text (no empty turn saved)
- [x] Edited turns show left-border accent indicator; indicator absent on unedited turns
- [x] "Reset transcript" button disabled with fresh transcript; enabled after editing; confirmation prompt shown on click; confirming restores all turns; indicator clears
- [x] `npm test` passes including both new test cases and the two fixed existing fixtures

---

### Phase 2: Copy/Export without timestamp preference [QA]

**Goal**: Add `includeTimestamps` boolean preference wired through settings UI to both export handlers, with a testable pure helper.

**Covers**: SC-4, SC-6 (partial)

**File scope**: `src/shared/ipc-types.ts`, `src/main/settings/store.ts`, `src/main/ipc/settings.ts`, `src/main/ipc/export.ts`, `src/renderer/views/SettingsView.tsx`, `src/renderer/i18n.ts`, `tests/unit/settings.test.ts`, `tests/unit/transcript-view.test.ts`, `README.md`

**Changes:**

**`src/shared/ipc-types.ts`** — extend `PreferenceKey` and `Preferences`. Add both `includeTimestamps` and `fontSize` in a single edit (Phase 3 shares this file — apply both here):

```ts
export type PreferenceKey = 'recordingsFolder' | 'defaultLanguage' | 'defaultProvider' | 'appLanguage' | 'includeTimestamps' | 'fontSize';

export interface Preferences {
  recordingsFolder: string;
  defaultLanguage: 'fr' | 'en' | 'auto';
  defaultProvider: ProviderName;
  appLanguage: 'fr' | 'en';
  includeTimestamps: boolean;
  fontSize: number;
}
```

**`src/main/settings/store.ts`** — add to `DEFAULT_PREFERENCES` (both keys at once):

```ts
includeTimestamps: true,
fontSize: 14,
```

**`src/main/ipc/settings.ts`** — add validation before the catch-all guard (both keys at once):

```ts
else if (key === 'includeTimestamps' && typeof value !== 'boolean') { return; }
else if (key === 'fontSize' && (![14, 16, 18, 20].includes(value as number))) { return; }
```

Update the catch-all list to include both new keys (replace the existing final `else if` guard):

```ts
else if (!(['recordingsFolder', 'defaultLanguage', 'defaultProvider', 'appLanguage', 'includeTimestamps', 'fontSize'] as string[]).includes(key)) { return; }
```

**`src/main/ipc/export.ts`** — extract a pure exported helper and update `formatTranscript`:

```ts
/** Pure helper — exported for testing. */
export function formatLine(name: string, startMs: number, text: string, includeTimestamps: boolean): string {
  return includeTimestamps ? `${formatTime(startMs)} ${name}: ${text}` : `${name}: ${text}`;
}

function formatTranscript(jobId: string, includeTimestamps: boolean): string {
  const turns = getTranscript(jobId);
  const mappings = getSpeakerMappings(jobId);
  const nameMap = new Map<string, string>();
  for (const m of mappings) {
    nameMap.set(`${m.chunk_index}::${m.speaker_label}`, m.display_name || m.speaker_label);
  }
  return turns
    .map(t => {
      const name = nameMap.get(`${t.chunk_index}::${t.speaker_label}`) || t.speaker_label;
      return formatLine(name, t.start_ms, t.text, includeTimestamps);
    })
    .join('\n');
}
```

Update both callers to read the preference and pass it:

```ts
// In export:to-file handler:
const { includeTimestamps } = readPreferences();
const text = formatTranscript(jobId, includeTimestamps);

// In export:to-clipboard handler:
const { includeTimestamps } = readPreferences();
const text = formatTranscript(jobId, includeTimestamps);
```

Add import at the top of `export.ts`:
```ts
import { readPreferences } from '../settings/store';
```

**`src/renderer/views/SettingsView.tsx`** — add `includeTimestamps` state; load alongside other prefs; add handler and toggle card.

State:
```tsx
const [includeTimestamps, setIncludeTimestamps] = useState(true);
```

In the prefs `useEffect`, add `getPreference('includeTimestamps')` to the `Promise.all`. Unpack with guard:
```ts
const tsVal = typeof ts === 'boolean' ? ts : true;
setIncludeTimestamps(tsVal);
```

Handler:
```tsx
const handleIncludeTimestampsChange = async (v: boolean) => {
  try {
    await setPreference('includeTimestamps', v);
    setIncludeTimestamps(v);
  } catch (e) { console.error('Failed to save includeTimestamps preference', e); }
};
```

Card (insert after the App language card, before the API keys heading):
```tsx
<div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
  <div className="card-body">
    <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('settings_export_heading')}</h3>
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={includeTimestamps}
          onChange={e => void handleIncludeTimestampsChange(e.target.checked)}
          disabled={!prefsLoaded}
          aria-label={t('settings_include_timestamps_label')}
          style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        {t('settings_include_timestamps_label')}
      </label>
    </div>
  </div>
</div>
```

Note: `accentColor: 'var(--accent)'` applies the Catppuccin Mauve tint to the browser-native checkbox. This is a standard CSS property with broad support and avoids a fully custom component while keeping the design coherent.

**`src/renderer/i18n.ts`** — add to `en` and `fr`:

```ts
// en
settings_export_heading: 'Export',
settings_include_timestamps_label: 'Include timestamps in copy/export',

// fr
settings_export_heading: 'Export',
settings_include_timestamps_label: 'Inclure les horodatages lors de la copie/export',
```

**`tests/unit/settings.test.ts`** — add both new defaults in the existing assertion:

```ts
expect(prefs.includeTimestamps).toBe(true);
expect(prefs.fontSize).toBe(14);
```

**`tests/unit/transcript-view.test.ts`** — update the `transcript text formatting` describe block. Replace the tautological test with a real call to `formatLine`:

```ts
import { formatLine } from '../../src/main/ipc/export'; // requires Electron mock setup or direct call

// If export.ts can be imported directly in the test environment (no Electron dep in formatLine):
describe('transcript text formatting', () => {
  it('formats a turn as [HH:MM:SS] Name: text when includeTimestamps is true', () => {
    expect(formatLine('Alice', 65000, 'Hello world', true)).toBe('[00:01:05] Alice: Hello world');
  });
  it('formats a turn as Name: text when includeTimestamps is false', () => {
    expect(formatLine('Alice', 65000, 'Hello world', false)).toBe('Alice: Hello world');
  });
});
```

Note: `formatLine` must not import from `electron` — it is a pure string function with no Electron dependency. Verify that `export.ts`'s imports at the top do not pull in `electron` modules before the function declaration; if they do, extract `formatLine` to a separate file `src/main/ipc/format-line.ts` (no Electron imports) and import from there in both `export.ts` and the test.

**`README.md`** — update the Exporting section (line near `Transcript format: ...`):

```
Transcript format (default): `[HH:MM:SS] Speaker Name: text`

Timestamps can be disabled in **Settings → Export**.
```

**Exit criteria**:
- [ ] "Export" card appears in Settings with a styled checkbox defaulting to checked
- [ ] Unchecking and exporting: `.txt` file and clipboard content have no `[HH:MM:SS]` prefix
- [ ] Checking (default): output is unchanged from current behavior
- [ ] Toggle state persists across app restart
- [ ] `settings.test.ts` new default assertions for `includeTimestamps: true` and `fontSize: 14` pass
- [ ] `transcript-view.test.ts` both `formatLine` paths (with/without timestamps) pass as real function calls
- [ ] README Exporting section updated

---

### Phase 3: Font size preference [QA]

**Goal**: Add `fontSize` preference wired through settings UI, CSS variable, sidebar scaling, and App.tsx mount effect.

**Covers**: SC-5, SC-6 (partial)

**File scope**: `src/renderer/styles/global.css`, `src/renderer/App.tsx`, `src/renderer/views/SettingsView.tsx`, `src/renderer/i18n.ts`, `tests/unit/settings.test.ts`

Note: `src/shared/ipc-types.ts`, `src/main/settings/store.ts`, `src/main/ipc/settings.ts` are edited once in Phase 2. Do not re-edit them in Phase 3.

**Changes:**

**`src/renderer/styles/global.css`** — add `--font-size-base` to `:root` block (after existing spacing tokens, before `--radius-sm`):

```css
/* Font size (user preference — updated dynamically by App.tsx on mount) */
--font-size-base: 14px;
```

In the `body` rule, replace `font-size: 14px` with:
```css
font-size: var(--font-size-base);
```

In `.turn-text`, replace `font-size: 13px` with:
```css
font-size: calc(var(--font-size-base) - 1px);
```

In `.sidebar-item`, replace `font-size: 13px` with:
```css
font-size: calc(var(--font-size-base) - 1px);
```

In `.sidebar-section-label`, replace `font-size: 10px` with:
```css
font-size: calc(var(--font-size-base) - 4px);
```

In `.sidebar-brand-sub`, replace `font-size: 10px` (if present) with the same expression. Leave other hardcoded sizes (h1/h2/h3 typographic scale, `.btn-sm`, `.badge`, `.turn-time`) unchanged — these are typographic constants, not body-text size followers.

Note: `.turn-text-editor` was defined in Phase 1 using `calc(var(--font-size-base) - 1px)` — it is already correct and requires no change here.

**`src/renderer/App.tsx`** — add a mount effect to read `fontSize` and apply the CSS variable:

```tsx
useEffect(() => {
  let alive = true;
  (window.electronAPI.invoke('settings:get-preference', { key: 'fontSize' }) as Promise<{ value: unknown }>)
    .then(({ value }) => {
      if (!alive) return;
      const size = [14, 16, 18, 20].includes(value as number) ? (value as number) : 14;
      document.documentElement.style.setProperty('--font-size-base', `${size}px`);
    })
    .catch(console.error);
  return () => { alive = false; };
}, []);
```

Note on startup flash: since 14px is the CSS default for `--font-size-base` AND the minimum selectable size, the async preference load only ever scales the UI upward. A user who selected 14px (default) sees no change at all; a user who selected 20px sees a brief 14→20 snap that resolves within one render after mount. This is acceptable for an accessibility preference.

**`src/renderer/views/SettingsView.tsx`** — add `fontSize` state, load it in the prefs `useEffect`, add handler and card.

State:
```tsx
const [fontSize, setFontSize] = useState<number>(14);
```

In the `useEffect` `Promise.all`, add `getPreference('fontSize')`. Unpack:
```ts
const sizeVal = [14, 16, 18, 20].includes(fSize as number) ? (fSize as number) : 14;
setFontSize(sizeVal);
```

Handler (also updates CSS variable immediately for live preview):
```tsx
const handleFontSizeChange = async (v: number) => {
  try {
    await setPreference('fontSize', v);
    setFontSize(v);
    document.documentElement.style.setProperty('--font-size-base', `${v}px`);
  } catch (e) { console.error('Failed to save fontSize preference', e); }
};
```

Card (insert after the Export card):
```tsx
<div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
  <div className="card-body">
    <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('settings_fontsize_heading')}</h3>
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">{t('settings_fontsize_label')}</label>
      <select
        className="form-select"
        value={fontSize}
        onChange={e => void handleFontSizeChange(Number(e.target.value))}
        disabled={!prefsLoaded}
        style={{ maxWidth: 200 }}
      >
        <option value={14}>{t('settings_fontsize_medium')}</option>
        <option value={16}>{t('settings_fontsize_large')}</option>
        <option value={18}>{t('settings_fontsize_xl')}</option>
        <option value={20}>{t('settings_fontsize_xxl')}</option>
      </select>
    </div>
  </div>
</div>
```

**`src/renderer/i18n.ts`** — add to `en` and `fr`:

```ts
// en
settings_fontsize_heading: 'Accessibility',
settings_fontsize_label: 'Text size',
settings_fontsize_medium: 'Medium (default)',
settings_fontsize_large: 'Large',
settings_fontsize_xl: 'Extra large',
settings_fontsize_xxl: 'XXL',

// fr
settings_fontsize_heading: 'Accessibilité',
settings_fontsize_label: 'Taille du texte',
settings_fontsize_medium: 'Moyen (défaut)',
settings_fontsize_large: 'Grand',
settings_fontsize_xl: 'Très grand',
settings_fontsize_xxl: 'XXL',
```

**`tests/unit/settings.test.ts`** — the `fontSize: 14` default assertion was added in Phase 2; no additional changes needed here.

**Exit criteria**:
- [ ] "Accessibility" card appears in Settings with a text-size select defaulting to Medium
- [ ] Selecting Large/XL/XXL immediately rescales body, sidebar items, and transcript text without reload
- [ ] Restarting the app restores the selected font size
- [ ] `settings.test.ts` `fontSize: 14` assertion passes (added in Phase 2)
- [ ] `.sidebar-item` and `.sidebar-section-label` scale proportionally (no wrapping or truncation at XXL on 1024px+ width)

---

## 6) Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Dev `db.sqlite` not deleted before first run after Phase 1 | High — `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables; missing `original_text` column causes NOT NULL crash on save | Phase 1 exit criterion explicitly checks schema; instructions call out manual deletion step |
| `settings:set-preference` catch-all not updated (Phase 2) | High — new preference writes silently rejected with no error to the renderer | Phase 2 adds both new keys to the catch-all list atomically; Phase 2 exit criterion verifies toggle persists across restart |
| `formatLine` export pulls in Electron deps via `export.ts` import chain | Medium — test file cannot import `formatLine` if `export.ts` transitively imports `electron` | If import chain includes `electron`, extract `formatLine` to `src/main/ipc/format-line.ts` with no Electron dependency |
| Phase 3 CSS changes break sidebar layout at XXL | Medium | Exit criterion requires visual check at XXL; sidebar item font-size uses relative offset to avoid dramatic size jumps |
| Textarea auto-height infinite resize loop | Low — `useEffect` triggers on `[editing, draft]`; setting `height` does not change `draft` or `editing`, so no loop | |

## 7) Verification

```bash
npm test        # must pass 0 failures
npm run dev     # manual: full flow per checklist below
```

Manual checklist:
1. Open a completed transcript. Double-click a turn → textarea with cursor.
2. Type changes, press Escape → text restored to pre-edit value. Double-click again → textarea.
3. Clear all text, blur → text restored (no empty turn). Type text, blur → text saved; reload from History → edit persists.
4. Edited turn shows left-border accent. Unedited turns do not.
5. "Reset transcript" button disabled on fresh transcript. Edit one turn → button enables. Click → confirmation prompt appears. Cancel → no change. Confirm → all turns restored, edited indicator clears.
6. Settings → Export → uncheck timestamps → Copy → paste → no `[HH:MM:SS]` prefix.
7. Settings → Export → recheck → Export → file has `[HH:MM:SS]` prefix.
8. Settings → Accessibility → select XXL → entire UI rescales including sidebar immediately.
9. Restart app → font size and timestamp preference preserved.

## 8) Documentation Updates

| Document | Update needed | Phase |
|---|---|---|
| `README.md` | Update Exporting section: `[HH:MM:SS]` format is default; note `Settings → Export` toggle | 2 |

## 9) Implementation Divergences from Plan

1. **DB migration strategy (Phase 1)**: Plan specified big-bang replacement (delete `db.sqlite`, re-create from schema). Instead, performed in-place `ALTER TABLE … ADD COLUMN original_text` + `UPDATE` backfill on the existing dev database. Rationale: user had 3 completed transcription jobs (438 turns) they did not want to lose. All existing turns have `original_text = text` (correct initial state). Behaviorally identical to a fresh schema for all new writes. Backup saved at `db.sqlite.bak_20260916_182200`.

## Follow-up Work (Deferred)

<Nothing deferred at plan time.>

## Review Log

### 2026-09-16 — Implementation Review (after Phase 1, persona: Senior engineer, Reliability engineer)

Implementation health: Green.
7 findings (0 High, 2 Medium, 5 Low). All resolved across 2 auto-fix cycles + 1 user-directed fix.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Medium | `updateTurnText`/`resetTranscript` had no `try/catch`; IPC failures silently swallowed; `error` state never set | Fixed — added `try/catch` calling `setError` in both callbacks (c9cb703) |
| 2 | Medium | Reset during active edit left `editing=true`; subsequent blur saved reset text as a user edit | Fixed — draft sync `useEffect` now also calls `setEditing(false)` (c9cb703) |
| 3 | Low | `.speaker-turn--edited` `padding-left` shifted edited turn content rightward vs unedited turns | Fixed — removed `padding-left`; used `margin-left: -2px` (c9cb703); then replaced with `box-shadow: inset` (8056c6f) |
| 4 | Low | `commitEdit` compared `trimmed !== turn.text` instead of `turn.text.trim()`; trailing whitespace in stored text caused spurious edits | Fixed — comparison uses `turn.text.trim()` (c9cb703) |
| 5 | Low | `updateTurnText` DB call returned void with no affected-rows check; stale ID silently no-oped | Fixed — checks `result.changes === 0` and throws (c9cb703) |
| 6 | Low | Component unmount while textarea focused would fire `commitEdit` on a stale turn | Accepted — React 18 `setState` safe after unmount; no alive-guard pattern in sibling hooks |
| 7 | Low | `startEdit` `setTimeout` not cleared on unmount | Fixed — `focusTimerRef` cleanup `useEffect` added (c9cb703) |

Cycle 2 introduced one new Low (margin-left clipped by implicit overflow-x): fixed in 8056c6f using `box-shadow: inset`.
QA: PASS (user runtime verification 2026-09-16).

#### Implementation notes

Implementation (2026-09-16, code: 08732c7)
Added `original_text TEXT NOT NULL` to `transcript_turns` in both `001_initial.sql` and the `MIGRATION_001` string in `index.ts`. Updated `saveTranscript` to bind `@text` twice (both `text` and `original_text` columns). Added `updateTurnText` (UPDATE with affected-rows check) and `resetTranscript` (transaction-wrapped UPDATE + SELECT) to `transcript.ts`. Registered both as new IPC handlers in `db.ts`. Extended `useTranscript` with `updateTurnText` and `resetTranscript` callbacks (await-then-patch pattern, try/catch to `setError`). Rewrote `SpeakerTurnItem` with double-click-to-textarea editing: `draft` state, auto-size `useEffect`, blur-commit with trim guard, Escape-cancel, `setEditing(false)` in the `turn.text` sync effect, `focusTimerRef` cleanup. Added `.speaker-turn--edited` (box-shadow inset accent) and `.turn-text-editor` CSS rules. Wired Reset button in `TranscriptView` header (`window.confirm` guard, `hasEdits` disabled state). Added 4 i18n keys in both `en` and `fr`. Fixed 2 existing `db.test.ts` fixtures missing `original_text`; added `updateTurnText` and `resetTranscript` test cases. Dev DB migrated in-place (ALTER TABLE + backfill) rather than deleted — 438 turns preserved with `original_text = text`.

### 2026-09-16 — Plan creation review (via /qplan, high effort)

4 personas: Architect, Senior engineer, Reliability engineer, End-user advocate. Cycle 1. 19 findings after dedup (9 High, 7 Medium, 3 Low). All High and Medium auto-resolved or resolved via user decision.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | High | `saveTranscript` INSERT won't bind `@original_text` — NOT NULL violation at runtime | Fixed — use `@text` twice in SQL; plan explains the better-sqlite3 named-param semantics |
| 2 | High | Preload `index.ts` not in any phase scope — new IPC channels could be blocked | Fixed — verified false positive: preload uses derived `InvokeChannel` type; no manual update needed; noted in Current State |
| 3 | High | Existing `db.test.ts` fixtures (`cascade` + `batch`) missing `original_text` — will break after schema change | Fixed — Phase 1 plan includes explicit fixture updates for both tests |
| 4 | High | `001_initial.sql` not in Phase 1 scope — test suite runs against old schema | Fixed — added to Phase 1 file scope with explicit sync requirement |
| 5 | High | `transcript-view.test.ts` no-timestamp test is tautological — never calls real function | Fixed — extract `formatLine` as exported pure helper; test calls it directly |
| 6 | High | `draft` state stale after reset — double-click after reset opens textarea with pre-reset text | Fixed — added `useEffect(() => { setDraft(turn.text); }, [turn.text])` in `SpeakerTurnItem` |
| 7 | High | Reset without confirmation — one-click data loss on long transcript | Fixed — user decision H8: add `window.confirm` before reset |
| 8 | High | Single-click edit conflicts with `user-select: text` — cannot copy text without entering edit mode | Fixed — user decision H9: switch to double-click; supersedes exploration decision Change-1 |
| 9 | High | `updateTurnText` optimistic update — DB failure leaves UI showing unsaved text | Fixed — await-then-update pattern; no optimistic update |
| 10 | Medium | `resetTranscript` non-atomic UPDATE + SELECT — crash between statements leaves inconsistent state | Fixed — wrapped in `db.transaction()` |
| 11 | Medium | `[P:2]`/`[P:3]` annotations on phases sharing files — `/qdev` might dispatch in parallel | Fixed — annotations removed from phase headings; phases are sequential |
| 12 | Medium | Empty-edit on blur silently discards — no user feedback | Fixed — blank-on-blur restores previous text; documented in Design Decisions and SC-1 |
| 13 | Medium | No visual indicator of edited turns | Fixed — `.speaker-turn--edited` left-border accent class added to Phase 1 |
| 14 | Medium | `.turn-text-editor` font-size hardcoded 13px instead of CSS var | Fixed — uses `calc(var(--font-size-base) - 1px)` from Phase 1; safe before Phase 3 via cascade fallback |
| 15 | Medium | Unstyled `<input type="checkbox">` inconsistent with design system | Fixed — uses `accentColor: var(--accent)` for native checkbox tinting; wrapped in `.form-label` |
| 16 | Medium | Sidebar font sizes not scaling with `--font-size-base` | Fixed — Phase 3 updates `.sidebar-item` and `.sidebar-section-label` to use CSS variable |
| 17 | Medium | Font-size startup flash at non-default sizes | Fixed — noted as imperceptible (14px default/minimum; only scales up); `alive` guard added to `useEffect` |
| 18 | Low | Missing `alive` guard in `App.tsx` font-size `useEffect` | Fixed — added `alive` guard with cleanup |
| 19 | Low | `aria-label` on turn-text span references input device ("Click to edit") | Fixed — changed to "Edit this turn text" |

## Harness Improvement Opportunities

<Reserved>
