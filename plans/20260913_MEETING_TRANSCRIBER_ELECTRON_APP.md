# Meeting Transcriber Electron App

> **Date**: 2026-09-13
> **Status**: Exploring  <!-- Status grammar: shared/skills/qplan/TEMPLATES.md § Status Grammar -->
> **Scope**: Windows-only Electron app for recording and transcribing meetings with speaker diarization via multiple cloud providers

---

## Intent

### Problem statement & desired outcomes

Users need a desktop app to transcribe meeting recordings (uploaded or recorded live) with speaker identification (diarization). The app must support multiple transcription providers and models, handle long recordings (up to 4 hours), allow users to identify each speaker by name, and export the result as a readable transcript. The focus is on French and English, with strong French accuracy as a priority.

### Success criteria

1. User can upload an audio file and receive a diarized transcript with speaker-labeled turns and timestamps, exportable to a formatted text file or clipboard.
2. User can record audio from the app (microphone + optional system audio loopback, device-selectable), pause/resume, then trigger transcription at the end of the session with the same export workflow.
3. All four providers (AssemblyAI, ElevenLabs Scribe v2, OpenAI gpt-4o-transcribe-diarize, Google Gemini 3.5 Transcribe) are integrated with per-provider credential configuration persisted securely via Windows Credential Manager (Electron safeStorage).
4. Speaker labels can be assigned real names inline in the transcript view, with audio playback at the corresponding timestamp to assist identification; all occurrences of the label update on rename.
5. Transcription history is persisted to SQLite; completed jobs survive app restart and can be re-exported without re-transcribing.
6. The app handles recordings requiring chunking (OpenAI ≤1500 s, Google ≤30 min with diarization) transparently, presenting all speaker labels across all chunks in the name-assignment UI.
7. The app runs on Windows only, as a foreground-only application with no background process or tray icon.

### Scope boundaries & non-goals

**In scope:**
- Windows only (x64)
- Batch transcription only (no real-time streaming during recording)
- One active job at a time (no parallel transcription or transcription-during-recording)
- Four providers: AssemblyAI, ElevenLabs Scribe v2, OpenAI gpt-4o-transcribe-diarize, Google Gemini 3.5 Transcribe
- MP3 recording format (128–192 kbps)
- Sidebar-navigation UI (Record, Upload, History, Settings)
- Export to formatted `.txt` and clipboard
- Persistent job history (SQLite, no search/filter in v1)
- Optional custom job title; falls back to auto-generated (date + duration + provider)
- Language selector per job (French / English / auto-detect)
- Playback speed control in transcript player (1x, 1.5x, 2x)
- Retry from scratch on transcription failure
- NSIS installer via electron-builder

**Out of scope (v1):**
- Real-time streaming transcription
- Local/offline models
- macOS or Linux
- Multiple simultaneous transcription jobs
- Loopback via virtual audio device (fallback to naudiodon native addon)
- Speaker reference clips (OpenAI diarize feature)
- Chunk-level retry checkpointing
- Transcript search or filtering
- `.docx` or `.md` export formats
- Background operation / system tray

---

## Exploration Discovery

<!-- Transient: /qplan folds these into the planning sections and removes this section. -->

### 4. Existing patterns & constraints

- Step 1.5 skipped — greenfield mode (no existing codebase).
- Step 1.5 skipped — greenfield mode noted in Discovery item 4 per skill convention.
- **Provider API constraints confirmed:**
  - AssemblyAI: 5 GB / 10 hr limit per job — no app-level chunking needed.
  - ElevenLabs Scribe v2: 10 hr limit; auto-chunks internally for >8 min — transparent to caller.
  - OpenAI gpt-4o-transcribe-diarize: 25 MB file size AND 1500-second (~25 min) hard duration limit — app must chunk all jobs before sending.
  - Google Gemini 3.5 Transcribe: 30-minute limit when diarization is enabled; 8-speaker cap (3+ speakers marked experimental in docs).
- **WASAPI loopback**: not exposed by Electron's standard Web Audio / MediaRecorder API. Requires a native Node addon (naudiodon) or equivalent. naudiodon prebuilt compatibility with current Electron LTS ABI is **unverified** — must be confirmed in Phase 1.
- **better-sqlite3 prebuilts**: same ABI concern as naudiodon — must be confirmed against target Electron version in Phase 1.
- **MP3 + Google Gemini**: accepted audio formats for Gemini 3.5 Transcribe were not fully enumerated in research — must be verified before the Google provider is implemented.
- **Electron safeStorage**: the correct mechanism for API key storage on Windows; encrypts with DPAPI, tied to OS user account.
- **electron-builder NSIS**: standard Windows installer path; native addons require electron-rebuild step at build time.

### 5. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| naudiodon prebuilts unavailable for target Electron ABI | Medium | High — WASAPI loopback blocked | Verify in Phase 1 before committing to architecture; fallback: ship MSVC build toolchain requirement or defer loopback |
| better-sqlite3 prebuilt ABI mismatch | Medium | High — history/persistence broken | Same: verify in Phase 1; fallback: use `sql.js` (WASM, no native) at cost of performance |
| Google Gemini does not accept MP3 | Low | Medium — Google provider requires different recording format or transcoding step | Verify in Google provider implementation phase; add FFmpeg transcoding step if needed |
| OpenAI speaker label reconciliation confuses users | Medium | Medium — "Speaker 1" in chunk 1 ≠ "Speaker 1" in chunk 2 | Surface all labels per chunk clearly in the mapping UI (e.g., "Chunk 1 – Speaker A", "Chunk 2 – Speaker A"); document as known limitation |
| 4-hour recording MP3 file size | Low | Low — ~90–130 MB at 128–192 kbps, well within all provider limits | No action needed |
| App-close mid-transcription loses job | Low | Medium — user loses context on long job | Persist job state to SQLite at start of transcription; show "job in progress" on next open with retry option |

### 6. Resolved decisions

- Q1: Platform target — A: Windows only — Decision: Windows-only build; no macOS/Linux support in v1.
- Q2: Provider/model scope — A: French & English focus; market report requested — Decision: Four providers in v1: AssemblyAI Universal-3.5 Pro, ElevenLabs Scribe v2, OpenAI gpt-4o-transcribe-diarize, Google Gemini 3.5 Transcribe. Anthropic has no transcription API.
- Q3: Provider scope for v1 — A: AssemblyAI + ElevenLabs + OpenAI + Google — Decision: All four providers implemented in v1.
- Q4: Batch vs streaming — A: Batch only — Decision: Batch transcription only; no real-time streaming.
- Q4b: Recording length — A: 30 min to 4 hours — Decision: App must support chunking for OpenAI (≤1500 s) and Google (≤30 min with diarization); AssemblyAI and ElevenLabs handle natively.
- Q5a: Speaker reference clips — A: Keep simple — Decision: Post-hoc label assignment only; no reference clip support.
- Q5b: Cross-chunk speaker reconciliation — A: Manual — Decision: Show all speaker labels across all chunks in the name-assignment UI; user assigns names manually.
- Q6: Export format — A: B — Decision: Structured text (speaker turn blocks with timestamps); `.txt` file export + clipboard; same format for both.
- Q7: Settings persistence — A: ok — Decision: Electron safeStorage (Windows Credential Manager / DPAPI) for API keys and provider settings.
- Q8: App distribution — A: ok — Decision: electron-builder NSIS installer for Windows.
- Q9: UI framework — A: ok — Decision: React + shadcn/ui component library.
- Q10: Recording input — A: Mic + system audio loopback, device-selectable — Decision: UI exposes mic device selector (enumerate available inputs); system audio loopback toggle; loopback via naudiodon native addon.
- Q11: Audio recording format — A: ok — Decision: MP3 at 128–192 kbps via MediaRecorder or WASM encoder.
- Q12: Recording storage location — A: ok — Decision: User-configurable folder; defaults to `%USERPROFILE%\Documents\MeetingTranscriber\`; recordings stored there.
- Q13: Post-transcription recording retention — A: ok — Decision: Keep recordings by default; deletion is an explicit user action.
- Q14: Transcript persistence — A: ok — Decision: Persistent history in SQLite (`%APPDATA%\MeetingTranscriber\db.sqlite`); history panel in sidebar.
- Q15: Parallel jobs — A: One at a time — Decision: Strictly one active job (recording or transcription); no concurrent jobs.
- Q16: UI layout — A: ok — Decision: Single window, left sidebar navigation (Record, Upload, History, Settings).
- Q17: Transcription progress feedback — A: ok — Decision: Progress indicator + status message (Uploading…, Transcribing…, Processing speakers…) + cancel button.
- Q18/Q18b: Speaker mapping UX — A: Inline with audio playback — Decision: Speaker labels clickable in transcript view; click seeks audio player to that timestamp and plays; user types real name inline; all occurrences update.
- Q19: Audio player features — A: ok — Decision: Play, pause, seek, playback speed (1x, 1.5x, 2x).
- Q20: Language selection — A: ok — Decision: Per-job language selector (French / English / auto-detect); passed as hint to provider API where supported.
- Q21: Error handling — A: ok — Decision: Fail with retry option; no chunk-level checkpointing in v1.
- Q22: Data storage — A: ok — Decision: SQLite via better-sqlite3; schema: jobs → transcript_turns → speaker_mappings.
- Q23: History search/filter — A: ok (browse only) — Decision: Chronological list only; no search or filter in v1.
- Q24: Job identification — A: ok — Decision: Optional custom title; falls back to auto-generated (date + duration + provider + language).
- Q25: Loopback capture — A: ok — Decision: naudiodon native addon for WASAPI loopback; must verify prebuilt availability in Phase 1.

### 7. Open items

1. **naudiodon + better-sqlite3 ABI compatibility**: verify both ship prebuilts for the chosen Electron LTS version before committing to these dependencies. If naudiodon prebuilts are unavailable, decide between: (a) ship with MSVC build requirement, (b) defer loopback to v2. Execution-contingent — resolve in Phase 1.
2. **Google Gemini accepted audio formats**: verify MP3 is accepted by Gemini 3.5 Transcribe API before implementing the Google provider. Deterministic — check official docs / test in Google provider phase.
3. **Testing strategy**: no test infra exists yet. `/qplan` should decide per-phase verification approach (unit tests for provider adapters, manual E2E for recording + transcription flow). Open item for `/qplan`.
4. **Electron version selection**: choose the current LTS (Electron 32 or 33 as of late 2026) — affects Node ABI and prebuilt availability for native addons. Deterministic — resolve in Phase 1.

### Assumptions (unconfirmed)

- App-close mid-recording: app prompts to save or discard the in-progress recording; does not silently lose data. (Edge cases)
- App-close mid-transcription: job state is persisted to SQLite at job start; on next open the user sees a failed/interrupted job with a retry option. (Edge cases)
- Accessibility: standard Electron/React defaults; no specific WCAG compliance required. (Quality attributes)
- Performance: no specific latency requirements beyond responsive UI during transcription wait. (Quality attributes)
- Transcript export filename: auto-generated from job title + date. (UX flow detail)
- Max speakers in mapping UI: 10 (covers most meetings; ElevenLabs supports 32, Google caps at 8). (Functional scope detail)

### 8. Recommended approach

**Architecture:**
- Electron (main process) + React renderer; IPC via `contextBridge` / `ipcRenderer`.
- Main process owns: audio recording (naudiodon for loopback, Web Audio API for mic), file I/O, SQLite (better-sqlite3), safeStorage, and all HTTP calls to provider APIs.
- Renderer owns: UI only; no direct API or file system access.
- Provider layer: one adapter class per provider implementing a shared `TranscriptionProvider` interface (`transcribe(filePath, options) → Promise<TranscriptResult>`); chunking logic lives inside the adapter for OpenAI and Google.

**Key modules:**
- `recorder`: wraps naudiodon (loopback) + Web Audio (mic); handles pause/resume; encodes to MP3; writes to configurable recordings folder.
- `chunker`: splits audio files at silence boundaries or fixed intervals for OpenAI/Google providers; implemented with ffmpeg-static.
- `providers/assemblyai`, `providers/elevenlabs`, `providers/openai`, `providers/google`: adapter implementations.
- `db`: better-sqlite3 wrapper; manages jobs, transcript_turns, speaker_mappings tables.
- `settings`: safeStorage-backed store for API keys and user preferences.

**UI structure:**
- Sidebar: Record | Upload | History | Settings
- Record view: device selectors (mic + loopback toggle), record/pause/stop controls, timer, waveform (optional v2).
- Upload view: file picker, provider/model/language selectors, transcribe button.
- Job progress view: status messages + progress indicator + cancel button (replaces record/upload view while job active).
- Transcript view: audio player (play/pause/seek/speed), speaker-labeled turn blocks with timestamps, clickable speaker labels for inline name assignment.
- History view: chronological job list with title, date, duration, provider, language; click to open transcript view.
- Settings view: per-provider API key fields, default recordings folder picker, default language.

**Build pipeline:**
- electron-builder with NSIS target for Windows.
- electron-rebuild step for native addons (naudiodon, better-sqlite3).
- ffmpeg-static bundled for audio chunking/transcoding.

### 9. QA environment

- **Runtime**: Windows 10/11 x64; launch with `npm run dev` (electron-forge or electron-builder dev mode).
- **Provider APIs**: each provider requires a live API key; manual testing against real APIs is required for provider integration phases.
- **Audio recording**: requires a physical microphone; loopback testing requires a running audio source (e.g., a video playing).
- **Long recording tests**: use pre-recorded MP3 files of known duration (30 min, 2 hr, 4 hr) for transcription integration tests without needing to sit through a live recording.
- **No automated E2E test infrastructure exists yet** — open item for `/qplan` Phase 1 to decide approach (Playwright for Electron, or manual-only for v1).
