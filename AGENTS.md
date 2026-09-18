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

Running `vitest` directly bypasses `pretest`, and the config then fails with an explicit message rather than starting. It previously excluded `tests/unit/db.test.ts` instead, which shrank the suite from 16 files to 15 with every remaining test still green — a dropped suite that looked like a passing one. **The suite is 18 files; a run reporting fewer means something is wrong.**
