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

`npm test` does **not** rebuild native addons — it only runs `vitest run`. Anything that triggers `postinstall` (including `npm install --package-lock-only`) rebuilds `better-sqlite3` for Electron, and `vitest.config.ts` then **silently excludes** `tests/unit/db.test.ts` rather than failing. The suite shrinks from 16 files to 15 with every remaining test still green, so a dropped suite is easy to miss. After any install, run `npm rebuild better-sqlite3 --prefer-offline` and confirm the file count is back to 16.
