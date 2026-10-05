# Test Plan: Recording feature (record -> stop -> transcription hand-off)

created: 2026-10-05T00:00:00+02:00
last_executed: 2026-10-05T13:20:00-05:00 — 7 verified findings (3H/4M), 3 candidates; 7/10 features covered, 3 partially verified (F3 no real 2-4 h run, F6 no lock/sleep, F8 no disk-full)
approach: organic
target: recording (src/main/recorder/*, src/main/ipc/recorder.ts, src/renderer/hooks/useRecorder.ts, src/renderer/views/RecordView.tsx, src/renderer/worklets/mic-capture.worklet.ts, src/main/app-lifecycle.ts, src/main/index.ts)
reported_symptoms: (1) problems after long recordings, 2-4 h; (2) problems after changing menus (views) during a recording. Exact failures not recorded by the reporter.

## Oracle

No spec exists for long-run or navigation behavior. The oracle is derived, in this order:
1. Code header comments (src/main/recorder/index.ts, encoder.ts, useRecorder.ts) state intent: IPC-batched PCM at ~20 calls/s, 128 kbps mono MP3, pause drops PCM, flush returns an intact file within 5 s, `recorder:progress` is the source of truth for status and duration.
2. Product invariant (applies to every probe): **a recording in progress must never be lost, orphaned or made un-stoppable by any UI action, and Stop must always yield a playable MP3 whose duration matches wall-clock minus pauses within 1 s per hour.**
3. `AGENTS.md` Test Execution and Development Safety rules (isolated profile, no `src/main/**` edits while `npm run dev` runs).

## Components and tiers

One component, three layers. Steps 4 and 6 of plan mode were collapsed into one user confirmation.

| Tier | Layer under test | Driven by | Rigor |
|---|---|---|---|
| A | main-process recorder + encoder worker | node harness importing the compiled recorder, synthetic PCM fed faster than real time | 4 h of audio volume in minutes |
| B | full Electron app (renderer + IPC + main) | built app launched with `--remote-debugging-port`, isolated `--user-data-dir`, Chromium fake audio device reading a WAV; driven over raw CDP per `qbrowser-test` Electron fallback | ~30 min real-time soak plus interaction probes |
| C | record -> stop -> real transcription | same as B, ~30 s clip, real provider (user approved the billed call) | single pass |

`resource_constraints`: B and C share one Electron instance and one userData dir (single-instance lock), so they run sequentially, never in parallel. A is independent and can run first or in parallel with B only if it uses its own temp folder and no Electron.

## Feature manifest (each with the 5-item intelligence)

### F1. Navigation during a recording (priority 1, reported symptom)
- **what**: Recording keeps running, stays controllable and ends in a transcription job when the user visits other views and comes back.
- **how-to-reach**: Tier B. Start a recording on Record. Click Sidebar entries (Upload, History, Settings, a transcript, Progress) while `recording` and while `paused`. Return to Record. Press Stop.
- **probes**: switch to each of the 5 other views x {recording, paused}; rapid A-B-A-B switching; switch during the `stopping` window; switch, then Start (does the button show while main is recording?); switch and wait 60 s then return; Stop after return (does a job start, is `jobIdRef`/`currentJobId` lost, is `onJobStarted` called?); leave via Settings and change the default provider or delete the API key, then return and Stop; check main log for pcm chunks still arriving after unmount; check `AudioContext`/mic track state after unmount via CDP.
- **oracle**: product invariant. Code evidence: `App.tsx:66-91` renders one view at a time, `useRecorder` holds all session state in refs with no unmount effect.
- **risks**: H1, H10. Unmount orphans mic, worklet and IPC pump. Remount shows a Stop button that cannot start a job. Stop is blocked by `providerKeyMissing` or a bad speaker-count hint (`RecordView.tsx:101-108`) while recording continues.

### F2. Stop and job hand-off
- **what**: Stop flushes the MP3, then navigates to progress and starts the transcription job.
- **how-to-reach**: Tier B. Start, wait, Stop. Tier C for the real job.
- **probes**: Stop at 5 s, at 5 min, while paused; double-click Stop; Stop with speaker hint set to an invalid range; Stop with provider key removed; Stop when the flush errors; verify the `job-<ts>.mp3` exists and is the path passed to `transcription:start-job`; verify DB job row appears once.
- **oracle**: product invariant; `RecordView.tsx:114-137` comment states navigate-before-start ordering.
- **risks**: H10 (a validation failure at Stop leaves recording running), H5 (flush timeout), double job creation.

### F3. Long-run capture (priority 1, reported symptom)
- **what**: A 2-4 h recording stays stable in memory, latency and file integrity.
- **how-to-reach**: Tier A for 4 h of audio volume: feed `Int16Array` chunks of 2205 samples through `receivePcmChunk` at accelerated rate (no wall-clock wait). Tier B for 30 min real time with the fake audio device looping a WAV.
- **probes**: sample main RSS, encoder worker heap, renderer JS heap, IPC round-trip latency and write-stream `writableLength` every 10 s; compare first and last 5 min; measure flush time of the final file (~230 MB expected at 128 kbps for 4 h); verify MP3 frame continuity and duration (ffprobe from `ffmpeg-static`); sustained bursty PCM (simulated 500 ms stall then catch-up); progress timer drift vs wall clock; meter re-render rate.
- **oracle**: product invariant; sizing arithmetic (4 h mono at 128 kbps ~ 230 MB; ~288 M `number[]` elements through IPC).
- **risks**: H5, H9. `Array.from(Int16Array)` per batch, unbounded `outputStream.write` buffering, 5 s flush timeout on a large file. Accelerated feeding exposes backlog sooner than real time does, so interpret Tier A backlog results as upper bounds.

### F4. Pause and resume
- **what**: Pause drops audio, resume continues, duration excludes paused time.
- **how-to-reach**: Tier B (UI buttons) and Tier A (`pauseRecording`/`resumeRecording`).
- **probes**: pause/resume x 200 rapid toggles; pause for 10 min then Stop; pause then switch view then resume; pause then Stop; pause then close window; failure ordering (`isPausedRef` set before IPC resolves).
- **oracle**: `getRecordingDurationMs` excludes pauses; encoder drops `pcm` while paused.
- **risks**: H7. Client and main can disagree on pause state; the `'stopped'` progress status is never sent.

### F5. Window close, quit, crash
- **what**: Closing the window, quitting the app or crashing mid-recording preserves audio and leaves a sane DB.
- **how-to-reach**: Tier B. Isolated profile only.
- **probes**: close window with X while recording and while paused; Ctrl+Q / `app.quit()`; quit dialog "Stop & Save", "Discard", "Cancel" (then verify the DB is still open and writes work); kill the main process (`taskkill /F`) at 2 min; relaunch and inspect the partial MP3, the job row and any leftover `electron.exe`.
- **oracle**: `app-lifecycle.ts` dialog text ("Stop & Save"); product invariant.
- **risks**: H2 (window already destroyed so `getMainWindow()` is null and `app.exit(0)` skips the flush), H3 (second `before-quit` listener calls `closeDb()` regardless of `preventDefault`).

### F6. Background, throttling, power (system probes, user-approved)
- **what**: Capture survives minimise, occlusion, screen-off and (where reachable) lock and sleep.
- **how-to-reach**: Tier B. Minimise via CDP `Browser.setWindowBounds`; occlude with another fullscreen window; read audio progress continuity.
- **probes**: minimise 10 min; occlude 10 min; compare MP3 duration to wall-clock; check gaps via sine-sweep fixture. Lock and sleep cannot be driven from this session: mark `partially-verified (library-level)` and list the manual steps for the user.
- **oracle**: product invariant.
- **risks**: H4. No `powerSaveBlocker`, `backgroundThrottling` not disabled.

### F7. Device lifecycle and silent-input detection
- **what**: Unplug, device change and dead input are surfaced to the user.
- **how-to-reach**: Tier B with fake device; real unplug is manual-only.
- **probes**: `devicechange` events during recording; track `ended` simulation via CDP (`track.stop()` on the live stream); silent WAV for >15 s (banner appears); silence then speech (banner clears); selected device removed before Start.
- **oracle**: `SILENCE_WARN_MS` comment in `useRecorder.ts`; `RECORDER_ERROR_KEY` map.
- **risks**: H6. No `track.onended` handler, so a lost device yields silent hours with no warning beyond the 15 s banner.

### F8. Disk and flush edge cases
- **what**: Low-disk, full-disk and slow-disk paths.
- **how-to-reach**: Tier A with a small virtual disk or throttled path; Tier B for the low-disk dialog.
- **probes**: recordingsFolder on a tiny VHD (<500 MB) for the dialog; fill to 100% mid-recording; slow writes (AV scanner simulation) then Stop; path outside recordings folder (confinement check at `recorder/index.ts:72-78`); UNC or non-existent folder.
- **oracle**: dialog text at `recorder/index.ts:96-101`; 5 s flush limit.
- **risks**: H5. Write-stream `error` is posted to the parent but main registers no `message` handler until Stop, so a mid-recording disk-full error is silent.

### F9. Mutual exclusion and re-entrancy
- **what**: Recorder and transcription never run together; double invocations are safe.
- **how-to-reach**: Tier A for recorder calls; Tier B for UI.
- **probes**: Start twice; Start while `stopping`; Stop while idle; Stop twice concurrently (second awaits a null worker); Start while a transcription job is active; transcription start while recorder active; Start immediately after Stop returns.
- **oracle**: `ipc/recorder.ts:28`, `ipc/transcription.ts:12-14`.
- **risks**: H8. Concurrent `stopRecording` calls share one `once('message')` slot.

### F10. Tiny end-to-end (Tier C)
- **what**: 30 s recording through the real app yields a transcript.
- **how-to-reach**: Tier B setup, fake mic reading the 10 s fixture speech sample looped, real provider selected in the isolated profile.
- **probes**: single happy path; verify transcript row, audio path, cost row.
- **oracle**: user statement that transcription works.
- **risks**: billed external call (approved); secrets must be copied by file, never read into context.

### Scoped out
- Transcription provider behavior and the chunker beyond the first hop (user states transcription works). Optional add-on if time: run `chunkAudio` on the 4 h Tier A file without a provider call.
- System audio loopback (`loopback.ts`; naudiodon unavailable on Electron 36, per the UI banner).
- Real hardware unplug, screen lock, sleep: manual-only; steps will be listed in the report.

## Candidate defect register (from reading code, all unverified)

H1 view-switch orphans session; H2 window-close skips flush; H3 `before-quit` closes DB on Cancel; H4 no sleep/throttle protection; H5 5 s flush timeout and unbounded write buffering; H6 no `track.onended` handling; H7 pause/duration/`'stopped'` inconsistencies; H8 concurrent Stop slot sharing; H9 resource growth over hours; H10 Stop blocked by key/hint validation.

## Run-mode notes

- Execution agents are naive: brief them with this plan plus `plans/tests/HARNESS.md`, not source. The refuter (full rigor) gets source.
- Tier A must finish before B and C, because B needs a built app and a known-good encoder.
- State hygiene: isolated `--user-data-dir`, temp `recordingsFolder`, delete test MP3s afterwards, confirm no orphaned `electron.exe` before and after (AGENTS.md Development Safety).
- Do not edit `src/main/**` during a running dev instance. Prefer `electron .` on a fresh `vite build` over `npm run dev` so no auto-restart can touch a live DB.
