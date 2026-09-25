# Meeting Transcriber — Agent Guidelines

## Doc & Test Guidelines

- Update existing documentation files when implementing user-visible changes.
- Do not create new documentation files unless the user requests them.
- Update README.md only when changes affect installation, basic usage, or user-visible CLI surface.
- Update existing tests when implementation changes. Do not introduce new test files unless the user requests them or a regression bug fix requires one.
- New test files are permitted for a new feature module (a new directory under `src/main/` or `src/renderer/`). Extending an existing module still updates that module's existing test file.
- When the user requests something that contradicts these guidelines, apply the request AND propose a durable update to this section so future sessions follow the new policy.

### Test Execution

Run tests from the repo root with `npm test`; do not run `vitest` directly.

`better-sqlite3` can only be built for one target at a time: Electron for `npm run dev` and packaging, Node for the test runner. Both directions now repair themselves — `pretest` rebuilds for Node, `dev` and `postinstall` rebuild for Electron — so no manual step is needed when switching between running the app and running the tests.

Running `vitest` directly bypasses `pretest`, and the config then fails with an explicit message rather than starting. It previously excluded `tests/unit/db.test.ts` instead, which shrank the suite from 16 files to 15 with every remaining test still green — a dropped suite that looked like a passing one. **The suite is 19 files; a run reporting fewer means something is wrong.**

The golden summary test (`tests/unit/summary-golden.test.ts`) is a stub. It runs the real-data test from the private repo cloned as `../meeting_transcriber-private` (override: `MT_PRIVATE_FIXTURES`, resolved against the repo root), and shows as 1 skipped file when that clone is absent. A set `MT_PRIVATE_FIXTURES` without the private module is an error. Never commit real meeting data, names, quotes, or recording details to this repo, including `plans/` and `memory/`; check new plan and memory text against the private repo's `scrub/` term files before pushing.

If `npm test`'s `pretest` hook fails with `'node' is not recognized...` or similar, this Windows account's `PATH` may be too long for `cmd.exe` to resolve `node`/`npm` when npm spawns script hooks through a `cmd.exe` child process, even though the interactive shell resolves them fine. Workaround: set `npm_config_script_shell` to a Git Bash `bash.exe` path before running `npm test`, routing npm's script execution through Git Bash instead of `cmd.exe`.

If `pretest` still fails afterward with `'npm' is not recognized` (typically after switching `better-sqlite3` to the Electron ABI via `npm run dev` and back), run `npm rebuild better-sqlite3 --prefer-offline` once, manually, before `npm test` — `native-for-node.cjs`'s own rebuild call goes through a nested `cmd.exe` subprocess that `npm_config_script_shell` doesn't reach. If even that plain `npm rebuild` invocation fails the same way (`'prebuild-install'`/`'node-gyp' is not recognized`), bypass `npm`/`cmd.exe` entirely: run `node node_modules/prebuild-install/bin.js` with the working directory set to `node_modules/better-sqlite3`.

### Development Safety

Editing `src/main/**` while an `npm run dev` instance is running executes the new main-process code — including DB migrations — against the live `userData` database via Vite's main-process auto-restart, with no warning. Before starting a background `npm run dev` instance, confirm no prior instance survived a previous stop (check for orphaned `electron.exe` processes) and confirm it is fully stopped before touching `src/main/**` again.
