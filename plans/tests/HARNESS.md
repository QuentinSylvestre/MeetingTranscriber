# Test Harness
last_run: 2026-10-05T13:20:00-05:00

Names only. Never credential values. This repo is public.

## Resources
| Name | Type | Availability | Constraints | last_verified |
|---|---|---|---|---|
| isolated-userdata | profile dir | always | pass `--user-data-dir` to Electron; never the live profile; delete after run | 2026-10-05 |
| temp-recordings-folder | folder | always | set `recordingsFolder` in the isolated profile; delete after run | 2026-10-05 |
| fake-mic-wav | audio fixture | always | Chromium flags `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>`; derive from `tests/fixtures/10s-silence.mp3` or a generated tone/speech-like WAV; use no real meeting audio | 2026-10-05 |
| electron-cdp | tool | always | raw CDP over `--remote-debugging-port` per qbrowser-test Electron fallback; needs a fresh `vite build` for `electron .` | 2026-10-05 |
| provider-key-assemblyai | credential | user-held | name only; copy settings file into isolated profile without reading it; billed call approved for the 30 s Tier C clip | 2026-10-05 |
| small-volume | VHD | on demand | for low-disk and disk-full probes (F8); needs admin to mount; skip and mark BLOCKED if unavailable | 2026-10-05 |
| ffprobe | tool | always | via `ffmpeg-static` in node_modules; validates MP3 duration and frame continuity | 2026-10-05 |

## Operational notes (run 2026-10-05)
- Confirmed working: `electron .` on a fresh `vite build`, `--remote-debugging-port`, `--user-data-dir`, Chromium fake-audio flags, raw CDP via Node's global WebSocket. Page-level CDP has no `Browser` domain; minimize and close via user32 `ShowWindow` / `CloseMainWindow` from PowerShell instead.
- A copied `secrets.json` plus `Local State` lets an isolated profile use the real key with no key read. For probes that press Stop, set a dummy key through `settings:set-secret` instead, so no job can bill.
- Not admin on this machine: VHD mounting (F8 disk-full, low-disk dialog) is BLOCKED. C: had ~12 GB free.
- Windows TTS (`System.Speech`) produces a synthetic-speech WAV for Tier C; no real meeting audio needed.
- The harness stopped a 30-minute background soak at 27.6 min on low system memory; run long soaks when the machine is idle.
- `dist/`, `dist-electron/` were rebuilt and better-sqlite3 was left on the Electron ABI; `npm test` (pretest) switches it back.

## Constraints
- Single-instance lock: one Electron instance at a time.
- `better-sqlite3` ABI: Electron for the app, Node for `npm test`. Run Tier A against compiled output or with `npm test` rules in AGENTS.md.
- Check for orphaned `electron.exe` before and after each run.
