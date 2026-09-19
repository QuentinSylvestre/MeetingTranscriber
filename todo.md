# Todo

- Find a permanent, secure storage location for the two test fixtures removed from
  git history and version control on 2026-09-19 (real, sensitive content — see
  `.gitignore` for why they're excluded):
  - `tests/fixtures/municipal-summary/golden-transcript.txt`
  - `tests/fixtures/municipal-summary/golden-summary.json`

  They currently exist in two places, both temporary:
  - On disk at their original repo path (untracked, gitignored) — needed for
    `npm test` to pass locally.
  - A backup copy + a full pre-rewrite git bundle at
    `../meeting_transcriber-PRIVATE-BACKUP/` (sibling folder, outside this repo).

  Once a permanent location is chosen, the local copies and the sibling backup
  folder can be deleted, and this repo path re-populated from that location
  whenever `npm test` needs to run (e.g. after a fresh clone).

- `tests/unit/summary-golden.test.ts` reads the two fixtures above at module scope
  (not inside a test body). On any machine/clone without them present on disk,
  that test file fails to load — this was left unguarded intentionally rather than
  adding a skip-if-missing check, per the choice made when the fixtures were
  removed from git.
