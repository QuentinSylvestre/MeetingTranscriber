# Private fixture repo for the real-data golden test, and a history scrub of the public repo

> **Date**: 2026-09-25
> **Status**: In Progress
> **Last Updated**: <set by /qclose at archival>
> **Scope**: Move the real-meeting golden test and all reference recordings/documents into a new private GitHub repo loaded through a public data-free stub, then rewrite the public repo's history so no real-meeting content or personal identifier remains in any reachable commit, tag, or commit message.
> **Estimated effort**: ~1 day

> **Public-file rule for this plan.** This file lives in a public repo and survives the rewrite. It must never contain a real name, quote, place name, meeting date, figure, fixture/blob SHA, pre-rewrite commit SHA, or the leaked path itself. Those live only in the private repo (term list, replacement rules, SHA-check list, rollback note). The rule also covers the Review Log, §9, every commit message this plan produces, and the output of every agent or reviewer working on it; state it in their briefs. Never paste test output, error messages, stack traces, or absolute paths into any of them; summarize as counts or pass/fail. During Phases 1-4, progress entries in this file carry no commit SHAs; Phase 6 records them afterwards using rewritten SHAs only.

---

## Intent

### Problem statement & desired outcomes

The public repo `QuentinSylvestre/MeetingTranscriber` still carries private content from a real municipal-council meeting, even after the 2026-09-19 fixture purge:

- `tests/unit/summary-golden.test.ts` embeds real speaker names, verbatim quotes, the real agenda with local place names, real figures and timestamps, the fixture's SHA-256, and a line naming sensitive off-topic personal subjects.
- One archived plan contains an absolute Windows path exposing the author's username, employer, and the reference-recording folder name.
- Several test strings, plan lines, and commit messages carry lower-sensitivity meeting-derived details (meeting dates, agenda-item wording, and references that identify the specific real recording). The generic fact that a private real-data test tier exists is public by design and is not scrubbed.

The real fixtures and reference recordings/documents also have no versioned, access-controlled home: they sit in a gitignored folder, a local backup folder, and a Downloads folder.

Desired outcome: a private repo versions all real reference material and the real-data golden test. The public repo keeps an 18-file test suite in which the golden test runs when the private repo is present and shows as skipped otherwise. No reachable public commit, tag, or commit message contains private content.

### Success criteria

1. A private GitHub repo `QuentinSylvestre/MeetingTranscriber-private` exists and holds: the two golden fixtures, the current golden test body (moved unchanged except for its two `src` imports and two fixture URLs), the reference-meeting audio (lossless `.m4a` remux), transcript text, both compte-rendu `.docx` files, the unzipped v1 bundle (expected `.docx`, spec, system and user prompts), the second meeting's audio and transcript, the two short test clips, the Phase 8 verification `.docx`, the history-scrub term list and replacement rules, and a short README.
2. `tests/unit/summary-golden.test.ts` in the public repo contains no private content. It resolves the private dir (`MT_PRIVATE_FIXTURES`, else the sibling `../meeting_transcriber-private`), dynamically imports the private test module when present, and registers a visible skip otherwise.
3. `npm test` reports 18 test files in both states: all passing with the sibling present, and 17 passing plus 1 skipped with it absent and `MT_PRIVATE_FIXTURES` unset. A set `MT_PRIVATE_FIXTURES` that does not contain the private module fails loudly.
4. `scripts/summary-eval.cjs` finds the golden transcript through the same resolver instead of the hardcoded `tests/fixtures/...` path.
5. After the rewrite, a grep of every reachable blob and commit message on `main` and both tags (`git grep` over `git rev-list --all`, plus `git log --all --format=%B`) for the private term list returns zero hits. The term list is kept in the private repo.
6. Remote `main`, `v0.1.0`, and `v0.1.1` point to rewritten commits. Both GitHub releases still exist with their original assets (`.exe`, `latest.yml`), unchanged by the push.
7. Local leftovers are gone: the pre-rewrite rollback bundle (kept outside OneDrive, deleted after verification), `../meeting_transcriber-PRIVATE-BACKUP/` including the old bundle, the `refs/codex/...` checkpoint ref, and this clone's unreachable objects (reflog expire plus `git gc --prune=now`).
8. A read-only `gh api .../git/blobs/<sha>` check is documented and has been run once. It covers the old fixture blobs (SHA = `git hash-object` of each private fixture), the old golden-test blob, and one pre-rewrite commit. The result is recorded in the private repo, and §9 notes only that it was recorded.

### Scope boundaries & non-goals

In scope: the private repo and its contents, the public stub, the `@src` alias in `vitest.config.ts`, the `summary-eval.cjs` resolver, the history rewrite (category 1: remove the golden test path from all commits; category 2: replace the leaked Windows path; category 3: replace meeting-derived dates and wording in tests, plans, and commit messages), the tag and branch force-push, local cleanup, and doc/governance updates.

Non-goals:
- A synthetic Tier 1 public golden fixture. Deferred; reopen if the golden test should run on public clones or in CI.
- A GitHub Support purge request. The user declined it (Q2); old objects may stay fetchable by SHA for an unknown time.
- Making the repo private during the work. The user declined (Q2).
- Git LFS. Deferred until a recording would exceed 100 MB.
- Moving dev folders out of OneDrive. The user will do this separately later.
- Deleting the original reference-recording folder in Downloads. The user will do it themselves (Q8).
- The author identity in commits, `LICENSE.md`, and `electron-builder.yml`. Public by design.

## 1) Current State

Code, cited by file and a unique string (line numbers drift):

- **Golden test** — `tests/unit/summary-golden.test.ts` (266 lines, added in a single commit and never modified). Reads both fixtures at module scope via `new URL('../fixtures/municipal-summary/…', import.meta.url)` (lines ~15-17). Imports `renderSummaryDocx` from `../../src/main/summary/render-docx`, `validateSummary` and `type MeetingSummary` from `../../src/main/summary/schema`, plus `jszip` and `vitest`. Transitive imports are only `docx` and `zod` (no Electron). A `describe.skipIf` alone cannot guard the import-time reads.
- **Vitest config** — `vitest.config.ts`: `assertSqliteBuiltForCurrentNode()` then `test: { exclude: ['node_modules/**'] }`. No alias, no include.
- **TypeScript** — `tsconfig.json` has `"paths": {}` and `"include": ["src"]`. Tests are not type-checked by `npm run build`.
- **Skip precedent** — `tests/unit/db.test.ts` uses `describe.skipIf(!Database)`.
- **Eval harness** — `scripts/summary-eval.cjs`, in the block starting `const transcript = fs.readFileSync(`, hardcodes `path.join(__dirname, '..', 'tests', 'fixtures', 'municipal-summary', 'golden-transcript.txt')`. It runs under `npx electron`, makes paid requests, and requires `dist-eval/` (absent). Not run by this plan.
- **Other references** — `.gitignore` (the "Real municipal-council transcript/summary" comment block plus two ignore lines); `README.md` (the paragraph starting "Municipal-summary tests cover"); `todo.md` (both items concern these fixtures); `AGENTS.md` `### Test Execution` ("The suite is 18 files"); `src/main/summary/generate.ts` (the "golden meeting is ~68k characters" comment, size only, not private).
- **Leaked path** — `plans/done/260915-2102_SETTINGS_PROVIDER_LANGUAGE_TITLE_I18N.md`, in the Intent's test-clip reference (~line 17). It is the only occurrence of the username/employer path in any commit.
- **Tags and releases** — annotated tags `v0.1.0` and `v0.1.1` (subjects are only the version). Both have GitHub releases with `latest.yml` and the installer `.exe`. The release workflow `.github/workflows/release.yml` triggers on `push: tags: 'v*.*.*'`, runs `npm run build -- --publish always`, then `scripts/finalize-github-release.cjs`, which deletes duplicate releases for the tag and publishes the one it keeps. **A tag force-push therefore re-runs publishing against the live releases.** It never runs `npm test`. Installers bundle only `dist-electron`, `dist`, and `package.json` (`electron-builder.yml` `files:`).
- **Git config** — the system gitconfig sets `core.autocrlf=true`. Both golden fixtures are LF-only, and the golden test pins the transcript's SHA-256, so a CRLF checkout breaks it.
- **SHAs in tracked files** — plan files under `plans/` and `memory/MEMORY.md` contain many commit SHAs as text (bookkeeping), some predating the 2026-09-19 purge. filter-repo rewrites SHAs in commit messages, not in file contents, so after the rewrite those SHAs point at pre-rewrite commits. Handled by Phase 4 step 8 (Q9).
- **`memory/MEMORY.md`** is tracked in the public repo and written by `/qdream` from session transcripts.
- **Local leftovers** — `refs/codex/turn-diffs/checkpoints/…` (a ref to a tree, not a commit), unreachable blobs of both real fixtures, `.git/filter-repo/` metadata from the 2026-09-19 run (including `already_ran`), the gitignored fixture copies under `tests/fixtures/municipal-summary/`, `../meeting_transcriber-PRIVATE-BACKUP/`, and gitignored `out/municipal*` folders that hold real-derived comparison output.

Runtime observations (re-run them; they expire):

- 2026-09-25, `gh api repos/QuentinSylvestre/MeetingTranscriber/git/blobs/<old fixture blob>` returned the full real-transcript blob. The pre-purge commit is also still served. The repo is public, with 0 forks, 0 stars, no PRs, and `traffic/clones` showing 45 clones from 22 unique cloners over 14 days.
- 2026-09-25, disposable vitest probes (scratch files, deleted afterwards):
  - A file outside the repo, run with `--dir`, resolves bare imports (`jszip`, `vitest`) and absolute `src/` imports.
  - A public stub that does top-level `await import(pathToFileURL(entry).href)` of an external module using an `@src` alias reports `1 passed` with the module present and `1 skipped (1)` without it.
  - A `describe.skipIf(true)` file still counts in the total (`1 passed | 1 skipped (2)`).
- 2026-09-25, `ffmpeg-static` probe: both reference `.mp4` files contain a single AAC mono stream (~125 kbps) and no video track.
- 2026-09-25: `git filter-repo` is not installed (neither on PATH nor as a Python module). `better-sqlite3` is currently built for Node.

## 2) Goal

Create a private repo holding every real reference artifact and the real-data golden test, loaded by a data-free public stub. Then rewrite the public history so that the post-rewrite `HEAD` tree is byte-identical to the pre-rewrite `HEAD` tree, and no reachable object or message matches the private term list.

## 3) Design Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Removal strategy (Q1, Q2) | Rewrite history with `git filter-repo`, force-push `main` and tags. No Support purge, no temporary private visibility. | Delete and recreate the repo; Support purge request | User choice. Residual exposure of old objects by SHA is accepted and made observable (Phase 6). |
| Where private assertions live (Q3) | Public data-free stub plus a private test module with the existing body | Whole file private (17-file suite); public test driven by a private expectations JSON | Smallest change, probe-proven, keeps the 18-file invariant and a visible skip. |
| Recording storage (Q4) | Lossless remux `.mp4` → `.m4a` (`-vn -c:a copy`), plain git | Lossy Opus re-encode; Git LFS | The files are already audio-only. The reference must stay faithful. It fits under 100 MB. |
| Private repo contents (Q5) | The whole reference-recording folder (both meetings, clips, docs, unzipped v1 bundle; `.zip` dropped) plus both golden fixtures | CM meeting and fixtures only | The second meeting is also real data. Clips are treated as real. |
| Locating the private repo (Q6) | One resolver: `MT_PRIVATE_FIXTURES` if set, else the sibling `../meeting_transcriber-private` | Env var only | No setup on this machine. A missing sibling gives a visible skip. |
| Rewrite scope (Q7) | Category 1 (golden test), 2 (leaked path), 3 (meeting-derived dates and wording in tests, plans, commit messages) | Categories 1 and 2 only | User asked for every private detail. |
| Local cleanup (Q8) | Delete the rollback bundle, old backup folder, codex ref, and unreachable objects after verification. Keep the Downloads originals. | Delete Downloads too; keep everything | User choice. |
| Resolver home | `scripts/private-fixtures.cjs` exporting `privateDir()` | A `.ts` module under `tests/` | `summary-eval.cjs` is CommonJS under Electron and cannot import `.ts`. Vitest imports `.cjs` natively. |
| Resolver contract | Return the absolute dir, or `null` when the sibling folder is absent. **Throw** when `MT_PRIVATE_FIXTURES` is set but `<dir>/tests/summary-golden.private.ts` does not exist, or when the resolved dir lies inside the public repo root. Export shape: `module.exports = { privateDir }`. | Always return `null` on absence | An explicit opt-in that points at nothing usable is a configuration error and must fail loudly. Only the implicit default may degrade to a skip. A private clone nested inside the public repo could be staged by accident. |
| Stub failure mode | Skip only when `privateDir()` is `null`. If the dir exists, import the private module unguarded, so a broken private module fails the file. | Wrap the import in try/catch and skip on error | A caught import error would turn a broken fixture into a green-looking skip, the failure `AGENTS.md` Test Execution warns about. |
| Private module location and name | `tests/summary-golden.private.ts` in the private repo. Fixtures in `fixtures/`, so the two `new URL` paths become `../fixtures/golden-summary.json` and `../fixtures/golden-transcript.txt`. | Keep the `*.test.ts` name | A non-`.test.ts` name can never be collected on its own if the private repo is ever nested or globbed. |
| How category 1 is removed from history | `--strip-blobs-with-ids` using the old golden-test blob id (stored in the private repo) | `--path … --invert-paths` | Blob-id stripping removes only the old content, so the stub committed in Phase 2 at the same path survives the rewrite. |
| HEAD scrub before the rewrite | Apply the category 2 and 3 replacements to `HEAD` as a normal commit (Phase 3) with the same strings the rewrite uses | Let `filter-repo --replace-text` change HEAD | HEAD edits get tested with `npm test` before the rewrite. The rewrite then leaves the `HEAD` tree unchanged, which gives a byte-exact verification (Phase 4). |
| Scrub rules location | `scrub/` in the private repo: `terms-literal.txt`, `terms-regex.txt`, `replacements.txt`, `strip-blob-ids.txt`, `rollback-note.md`, `exposure-check.md` | In the public repo, or in this plan | The rules contain the private strings themselves. |
| Codex ref timing | Delete `refs/codex/…` before the rewrite (Phase 4, user-confirmed step), not after verification | Delete after verification (literal Q8 ordering) | It is a Codex tool checkpoint of a tree, and it would carry the old test blob through the rewrite. Its target is recorded in the private rollback note first. Minor reordering of Q8; the Phase 4 confirmation gate asks the user. |
| Rewrite location | In place with `git filter-repo --force`, after a full `git bundle create --all` rollback bundle written to `$LOCALAPPDATA/mt-rewrite/` (not OneDrive-synced) | A fresh `--mirror` clone; bundle next to the repo | This clone holds the gitignored `node_modules`, `.env`, and build state. The bundle is the rollback. Writing it under OneDrive would create a new synced copy of the old history. |
| Release workflow during the tag push | Disable the `Release` workflow (`gh workflow disable`) before force-pushing tags, re-enable after, both user-confirmed | Accept two re-runs | A re-run rebuilds and republishes against the live releases and runs duplicate-release deletion, changing the assets auto-update clients check. |
| Tree-identity check | Record `git rev-parse HEAD^{tree}` before the rewrite and compare after | `git diff $PRE_HEAD HEAD` | filter-repo may expire reflogs and prune, making `PRE_HEAD` unresolvable, and a failing `git diff` prints nothing to stdout. Tree ids need no old objects. |
| No fetch between rewrite and push | Nothing fetches from `origin` from Phase 4 until the Phase 5 push completes | Fetch to restore tracking refs | A fetch would re-import the old history into `rev-list --all`. |
| No push before Phase 5 | Phase 2 and 3 commits stay local until the Phase 5 force-push | Push as usual | A normal push would publish pre-scrub commits that the rewrite then orphans but GitHub keeps. |
| Scrub rule format | `replacements.txt` holds only prefix-free `literal==>replacement` lines (no `regex:`/`glob:`, no bare lines), applied in file order to bytes. Terms split into `terms-literal.txt` (grepped with `-F -i`) and `terms-regex.txt` (`-E -i`). No blank lines. Dates in full format only, never a bare `YYMMDD` that could collide with plan-slug prefixes. | One `terms.txt` grepped as ERE | Literal paths and figures contain regex metacharacters, which gives silent false negatives. |
| `todo.md` | Delete it (both items are resolved by this plan) | Leave an empty `# Todo` | Nothing left to track. |
| SHAs written in tracked files (Q9) | After the rewrite and before the push, one local commit replaces every old commit SHA in current tracked text files with its new SHA, same abbreviation length, using the 2026-09-19 commit map composed with this rewrite's map | Accept stale SHAs; blank them in every historical blob | User choice (Q9: B). Fixes what readers of the repo see and keeps cross-references working. Old SHAs in historical file versions remain, the same exposure class accepted in Q2. |
| Category 3 boundary | Scrub specific identifying details (dates, agenda wording, recording-identifying file and bundle names). Keep the generic existence of a private real-data tier and generic "municipal" product wording, both public by design. | Scrub every mention that real data exists | The stub, `.gitignore`, and `AGENTS.md` must say a private tier exists. Interpretation of Q7, open to user veto. |
| Gitignored local fixture copies | Delete `tests/fixtures/municipal-summary/` in Phase 6, after the private repo is verified | Keep them | Stale copies of private data (Q8 A/B principle). Deleted after confirmation. |

## 4) External Dependencies & Costs

### Required external changes

| Category | Change needed | Owner | Status |
|---|---|---|---|
| Third-party services | Create the private GitHub repo `QuentinSylvestre/MeetingTranscriber-private` (`gh repo create --private`) | Agent, after explicit user confirmation (Phase 1) | Pending |
| Rollout / cutover | Force-push the rewritten `main` and both tags to `origin` | Agent, after explicit user confirmation (Phase 5) | Pending |
| CI/CD | Disable the `Release` workflow before the tag force-push, re-enable after (`gh workflow disable/enable`) | Agent, after explicit user confirmation (Phase 5) | Pending |
| Tooling | Install `git-filter-repo` (`python -m pip install --user git-filter-repo`) | Agent (Phase 4) | Pending |
| Cleanup after rollback window | Delete the local rollback bundle, old backup folder, local fixture copies, and unreachable objects | Agent, after explicit user confirmation (Phase 6) | Pending |
| Data migration / backfill | Copy the reference material into the private repo (Phase 1) | Agent | Pending |

### Cost impact

None. Private repos are free on the user's plan, and about 80 MB of content is well within GitHub's recommended repo size. `git-filter-repo` is free. No API calls: `summary-eval.cjs` is only syntax-checked, never run.

## 5) Implementation Phases

Order is strict: nothing destructive runs until the private repo exists and is verified (Phase 1), and nothing is pushed until the local rewrite is verified (Phase 4). Every commit message in this plan follows the public-file rule.

### Phase 1: Create and populate the private repo
**Goal**: A private repo, cloned as the sibling folder, holds every real artifact, the private test module, and the scrub rules.
**File scope**: `../meeting_transcriber-private/**` (new repo). No public-repo files.
**Why horizontal**: Phases 2-6 all depend on this repo (the stub's present state, the scrub rules, the cleanup precondition). It has no public-repo slice to pair with.

1. Ask the user to confirm, then run `gh repo create QuentinSylvestre/MeetingTranscriber-private --private` and clone it to `../meeting_transcriber-private`.
2. Layout:
   - `fixtures/` — `golden-transcript.txt`, `golden-summary.json` (from the gitignored copies; confirm they are identical to `../meeting_transcriber-PRIVATE-BACKUP/`).
   - `recordings/` — the reference meeting and the two clips. Remux `.mp4` inputs with the bundled ffmpeg (`node -e "console.log(require('ffmpeg-static'))"` from the public repo): `ffmpeg -i <in>.mp4 -vn -c:a copy <out>.m4a`. Copy `.mp3` and `.m4a` inputs as-is. Include the second meeting's `.m4a`.
   - `transcripts/` — the reference meeting `.txt` and the second meeting `.txt`.
   - `docs/` — both compte-rendu `.docx` files, the Phase 8 verification `.docx`, and the unzipped v1 bundle folder. Drop the `.zip`.
   - `tests/summary-golden.private.ts` — a copy of the current `tests/unit/summary-golden.test.ts` with exactly these edits: the two `../../src/main/summary/…` imports become `@src/main/summary/…`, and the two fixture URLs become `../fixtures/<name>`. Nothing else changes.
   - `scrub/` — `terms.txt`, `replacements.txt`, `strip-blob-ids.txt` (see step 3).
   - `.gitattributes` — one pattern per line: `* -text` (keeps fixtures and transcripts byte-exact under `core.autocrlf=true`), then `*.m4a binary`, `*.mp3 binary`, `*.docx binary`.
   - `README.md` — layout, how the public repo finds this folder (sibling convention, `MT_PRIVATE_FIXTURES` override), the "recordings over 100 MB → LFS" rule, the contents of `scrub/`, and that this repo tracks public `main` only (older public checkouts may fail the golden test).
   - When confirming step 1, tell the user the sibling folder sits in OneDrive sync, and that `MT_PRIVATE_FIXTURES` can point to a non-synced clone instead.
3. Build `scrub/` from the public repo:
   - `terms-literal.txt` and `terms-regex.txt`: every private term from the Intent categories, derived by grepping all history (`git grep -n -i -F … $(git rev-list --all)` and `git log --all --format=%B`). Start from the golden test's names, quotes, place and topic names, figures, bundle and file names, the SHA-256, the sensitive personal subjects, the leaked path's username and employer and folder segments, and the category 3 dates and wording. Add unaccented, case, and apostrophe variants (straight and curly), and single-word sub-terms for phrases that may wrap across lines. Iterate until a pass surfaces nothing new outside `tests/unit/summary-golden.test.ts`. Then do one bounded manual read of every historical diff under `plans/` and `tests/`, and every commit message, that mentions golden, municipal, meeting, fixture, or transcript, to catch English paraphrases the seeded grep cannot find.
   - `replacements.txt`: one `literal==>replacement` rule per category 2 and 3 hit outside the golden test, in the format fixed in Design Decisions. Use long, specific literals and neutral replacements (for example, a real date becomes a fictional date of the same format; the leaked path becomes `C:\path\to\test_60s.mp3`). Each replacement in a test file must keep that test's assertions consistent (Phase 3 proves it). Any rule whose hit is under `src/` is shown to the user before it is kept.
   - `strip-blob-ids.txt`: the blob id from `git rev-parse HEAD:tests/unit/summary-golden.test.ts`, taken before Phase 2 replaces the file (it is the only version the file ever had).
4. Commit and push. Clone it fresh into a scratch dir and verify there.

**Exit criteria**:
- [x] `gh repo view QuentinSylvestre/MeetingTranscriber-private --json visibility` reports `PRIVATE`.
- [x] The fresh scratch clone contains every item from SC 1.
- [x] In the fresh clone, the SHA-256 of `fixtures/golden-transcript.txt` equals the SHA-256 pinned inside `tests/summary-golden.private.ts`.
- [x] Each remuxed `.m4a` reports the same duration (ffmpeg `Duration:` line) and a single AAC stream, like its source `.mp4`.
- [x] `diff` between `tests/summary-golden.private.ts` and the public `tests/unit/summary-golden.test.ts` shows only the 4 import and URL lines.
- [x] A final grep with both term files over all public history returns hits only in files that `replacements.txt` or `strip-blob-ids.txt` covers, and in commit messages covered by `replacements.txt`.
- [x] `git -C <fresh clone> ls-files --eol fixtures transcripts` shows `i/lf w/lf` for every text file.
- [x] The scratch clone is deleted.

Implementation (2026-09-25, code: none)
Phase 1 populated the private repo with a single commit, pushed to its main branch. The commit contains the two golden fixtures, which are byte-identical to the backup copies. It also contains the private golden test module, which differs from the public test only in its 2 import lines and 2 fixture-URL lines. The rest of the reference material is 4 recordings, where each mp4 source was remuxed losslessly to m4a with a packet stream verified identical, plus 2 transcripts, 3 documents and the flattened 8-file v1 bundle. The commit also adds a `.gitattributes` that keeps every file byte-exact, a README, and the scrub rules: terms-literal.txt with 69 lines, terms-regex.txt with 16 lines, replacements.txt with 12 rules, and strip-blob-ids.txt with 1 id. The term lists were built from a seeded history scan, a capitalized-token pass and a 4-gram overlap pass against the private data, followed by a bounded manual read of related commit messages and plan and test lines. The final grep over all public history hits only 5 paths and 1 commit message. The first path is the golden test, which is covered by blob stripping. The other 4 are one archived plan with the leaked path, two versions of one plan, and one test file, all covered by replacement rules; the message is covered by a message rule. A simulated rewrite that drops the stripped blob and applies the rules to history rewrites 8 historical blobs and 1 commit message and leaves zero term hits. No rule touches `src/`, and no term matches a plan filename, a commit scope or a tag. In a fresh clone outside OneDrive, all 26 files were present and matched their sources, the transcript hash matched the pinned value, and all fixture and transcript files showed LF in both the index and the working tree. The clone and the scratch files holding private data were then deleted. All 8 Phase 1 exit criteria are ticked in this file. The file is left unstaged for the orchestrator to commit.

Review fixes (2026-09-25, code: none)
The Phase 1 review fixes were applied in the private repo as one extra commit, pushed to its main branch. For F1, the replacement value of one timestamp rule was changed to a fictional value. The new value has zero hits in the private fixtures, transcripts and documents (document text included), zero hits anywhere in public history, and no term hit. The rule is one global literal, so every public version of the affected test maps the same original value to the same replacement. For F2, the three names and one place name that appear only in private documents were added as forward-guard terms: 3 literal lines and 1 regex line, which brings the term files to 72 literal and 17 regex lines. Each has zero hits in public history, commit messages and scopes, plan filenames, tag contents and the current public plan file. For F3, the two paraphrased agenda items kept by user decision were added to the private README's keep-list with their reason. A re-run of the simulated rewrite still changes 8 historical blobs and 1 commit message and leaves zero term hits in blobs, messages and tags. The scrub files and README show LF in both the index and the working tree. The plan's exit-criteria ticks are unchanged.

Tests: not run (no public code change in this phase). QA: SKIP (no `[QA]` annotation, no runtime surface).

### Phase 2: Public stub, resolver, and alias [QA]
**Goal**: The public golden test becomes a data-free stub that runs the private module when present, and the eval harness uses the same resolver.
**File scope**: `scripts/private-fixtures.cjs` (new), `tests/unit/summary-golden.test.ts`, `vitest.config.ts`, `scripts/summary-eval.cjs`.
**Covers**: SC 2, 3, 4.

1. `scripts/private-fixtures.cjs` exports `privateDir()` via `module.exports = { privateDir }`, following the resolver contract in Design Decisions. With `MT_PRIVATE_FIXTURES` set, it returns `path.resolve(value)` if `<value>/tests/summary-golden.private.ts` exists and the path is outside the public repo root, and throws a message naming the variable otherwise (the message must not echo the absolute path). Unset, it returns `path.resolve(__dirname, '..', '..', 'meeting_transcriber-private')` if that is a directory, and `null` otherwise.
2. `vitest.config.ts`: add `resolve: { alias: { '@src': fileURLToPath(new URL('./src', import.meta.url)) } }`, matching the file's existing `import.meta.url` usage. Leave the header comment alone: its "16 files to 15" text is a historical account, not a current count.
3. Replace `tests/unit/summary-golden.test.ts` with the stub. Sketch (prose wins on conflict):
   ```ts
   // Real-meeting golden test lives in the private sibling repo; see AGENTS.md "Test Execution".
   import { describe, it } from 'vitest';
   import { pathToFileURL } from 'node:url';
   import path from 'node:path';
   import { privateDir } from '../../scripts/private-fixtures.cjs'; // if the named import fails, use createRequire(import.meta.url)
   const dir = privateDir();
   if (dir) await import(pathToFileURL(path.join(dir, 'tests', 'summary-golden.private.ts')).href);
   else describe.skip('golden municipal summary (private repo not found)', () => { it('requires the private fixture repo', () => {}); });
   ```
4. `scripts/summary-eval.cjs`: replace the hardcoded transcript path with `path.join(privateDir() ?? fail(), 'fixtures', 'golden-transcript.txt')`, where a `null` exits non-zero with a clear message before any key is read or any request is made. Update the header comment accordingly.

> **Rejected:** wrapping the dynamic import in `try/catch` and skipping on error — it turns a broken private module into a silent skip. **Use instead:** skip only when `privateDir()` returns `null`.

**Exit criteria**:
- [x] `npm test` with the sibling present: `Test Files 18 passed (18)`.
- [x] `npm test` with `MT_PRIVATE_FIXTURES` pointing to an empty scratch dir fails in `summary-golden.test.ts` with the resolver's error. With the variable unset and the sibling temporarily renamed: `17 passed | 1 skipped (18)`. The sibling is renamed back afterwards.
- [x] Mutation check: change one expected title in the private module, and `npm test` fails in `summary-golden.test.ts`. Revert.
- [x] `node --check scripts/summary-eval.cjs` passes, and `grep -n "tests', 'fixtures'" scripts/summary-eval.cjs` returns nothing.
- [x] `grep -n -i -F -f terms-literal.txt` and `grep -n -i -E -f terms-regex.txt` on the four files in File scope return nothing.
- [x] Commit locally (no push until Phase 5): `feat(260925_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB): phase 2 — load golden test from private repo`. No progress commit carrying a SHA.

Implementation (2026-09-25, code: SHAs withheld until the rewrite, per the public-file rule)
Phase 2 turns the golden summary test into a stub with no private data. It loads the real test from the private sibling repo. A new resolver, `scripts/private-fixtures.cjs`, exports `privateDir()`. When `MT_PRIVATE_FIXTURES` is set, it returns that directory, and it throws if the directory lies inside the public repo or lacks the private test module. The error message never includes the path. When the variable is unset, it returns the sibling `../meeting_transcriber-private` if that folder exists, and null otherwise. The stub skips only when the resolver returns null. It imports the private module without a try/catch, so a broken private module fails the file and cannot show up as a skip. `vitest.config.ts` gains an `@src` alias so the private module can import the summary sources. `scripts/summary-eval.cjs` now reads the transcript through the same resolver. If the resolver throws or finds nothing, the script exits with a clear message before any key is read. Its header comment names the new source. Verification: with the sibling present, `npm test` gives Test Files 18 passed (18). With the variable pointing at an empty directory, the golden stub fails with the resolver error. With the sibling absent, the result is 17 passed | 1 skipped (18). Changing one expected title in the private module makes the golden stub fail, and the module was restored afterwards. `node --check` passes on the eval script, which was not run. Both private term files return zero hits on the four changed files. The code was committed locally with the Phase 2 subject and not pushed. The six Phase 2 exit criteria are ticked in the project file, which is left unstaged.

Review fixes (2026-09-25, `fix` commit)
The review fixes harden the private-dir resolver in `scripts/private-fixtures.cjs`. An empty `MT_PRIVATE_FIXTURES` now counts as set and throws an error that names the variable. A relative value resolves against the public repo root, not the current directory. The inside-repo guard now compares real paths, so junctions and short names cannot bypass it. It also classifies a child folder whose name starts with two dots as inside the repo. When the variable is unset and the sibling folder exists but lacks the private test module, the resolver throws a path-free "found but incomplete" error instead of returning the folder. The header comment describes each rule. Verification: with the sibling present, `npm test` gives Test Files 18 passed (18). An empty scratch directory gives 1 failed in the golden stub. With the sibling absent, the result is 17 passed | 1 skipped (18). Node probes confirm each fixed case, and both private term files return zero hits on the four Phase 2 files. The fix was committed locally as a separate commit and not pushed. The Phase 2 ticks in the project file are unchanged.

Resolver test (2026-09-25, `test` commit, user decision)
A new test file, `tests/unit/private-fixtures.test.ts`, covers the private-dir resolver when `MT_PRIVATE_FIXTURES` is set. An empty variable throws, and the message names the variable. A temp directory without the private test module throws, and the message contains neither the temp path nor its real path. A relative value naming a folder inside the public repo throws the inside-repo error, and the message does not contain the repo root. A temp directory holding the private test module is returned, compared by real path. Each test saves and restores the variable and deletes its temp directories. The unset and sibling branch is not tested, because it depends on the machine; the golden stub covers it. The suite is now 19 files. With the sibling present it reports Test Files 19 passed (19), and without it 18 passed | 1 skipped (19). Both private term files return zero hits on the new file. The test was committed locally as a separate commit and not pushed. AGENTS.md is unchanged; its file count is updated in Phase 3. The Phase 2 ticks are unchanged.

Tests: pass (19 of 19 files after the resolver test). QA (`[QA]`, library surface, orchestrator-run): PASS. The resolver was called directly: sibling present returns the private dir; an empty dir, a missing path, and a path inside the repo (including a case-changed one) throw a path-free error naming the variable; a relative valid path resolves. The golden stub run alone passed 10 tests with the sibling present and failed with the resolver error when misconfigured. Observation: an empty variable fell back to the sibling; fixed by review finding 1.

### Phase 3: Scrub HEAD and update docs
**Goal**: The working tree at `HEAD` contains no private term, and docs reflect the new layout, before any history is touched.
**File scope**: `tests/unit/summary-render.test.ts` and any other file with a category 2 or 3 hit in `replacements.txt`, `plans/done/260915-2102_SETTINGS_PROVIDER_LANGUAGE_TITLE_I18N.md`, `plans/done/260919-0933_TRANSCRIBE_DEFAULT_PAGE_COST_TRACKING_DOCX_PERSISTENCE.md`, `README.md`, `todo.md` (delete), `.gitignore`, `AGENTS.md`.

0. Precondition: no `npm run dev` or `electron.exe` instance is running (`AGENTS.md` Development Safety), because a hit may land in `src/`.
1. Apply every `replacements.txt` rule to the current files: a small scratch script (not committed) that reads the rules in file order and does byte-literal replacement over `git ls-files` output, matching the rule format in Design Decisions, so HEAD and history cannot diverge.
2. `README.md`: rewrite the "Municipal-summary tests cover" paragraph. The golden regression lives in the private sibling repo, runs when present, and is skipped otherwise. Remove the `tests/fixtures/municipal-summary/` "contains the supplied transcript" claim.
3. Delete `todo.md`.
4. `.gitignore`: keep the two fixture ignore lines as a guard, and add `meeting_transcriber-private/`. Replace the whole comment block above them, including its "See todo.md" pointer (dangling once `todo.md` is deleted), with a neutral line, for example "Real meeting data lives in the private sibling repo; never commit it here."
5. `AGENTS.md` `### Test Execution`: **propose this edit to the user and apply it only on approval** (governance text). Proposed addition after the "18 files" paragraph: "The golden summary test (`tests/unit/summary-golden.test.ts`) is a stub. It runs the real-data test from the private repo cloned as `../meeting_transcriber-private` (override: `MT_PRIVATE_FIXTURES`), and shows as 1 skipped file when that clone is absent. A set `MT_PRIVATE_FIXTURES` without the private module is an error. Never commit real meeting data, names, quotes, or recording details to this repo, including `plans/` and `memory/`; check new plan and memory text against the private repo's `scrub/` term files before pushing."

**Exit criteria**:
- [x] `git grep -n -i -F -f terms-literal.txt HEAD` and `git grep -n -i -E -f terms-regex.txt HEAD` return zero hits. Canary: copy one tracked file to an untracked scratch path, add one known term, confirm the same grep pointed at the scratch file reports it, then delete it.
- [x] `npm test`: `Test Files 18 passed (18)` with the sibling present.
- [x] `README.md` golden-test paragraph updated, with no reference to fixtures in this repo.
- [x] `todo.md` deleted.
- [x] `.gitignore` comment reworded with no `todo.md` pointer, and the ignore lines kept.
- [x] `AGENTS.md` Test Execution note applied with user approval, or recorded as declined in §9.
- [x] Commit locally (no push until Phase 5): `docs(260925_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB): phase 3 — scrub HEAD and update docs`.

Implementation (2026-09-25, code: SHAs withheld until the rewrite, per the public-file rule)
Phase 3 scrubbed the public repo's HEAD and updated the docs, as one local commit (not pushed). A scratch script outside the repo applied the private replacement rules to every tracked file, as byte-literal replacements in rule order. Of the 12 rules, 11 matched in HEAD, making 14 substitutions across 3 files: two archived plans and one unit test. No `src/` path was touched. Line endings were preserved, and the diff contains only the intended strings. The README golden-test paragraph now says the real-data regression lives in a private sibling repository, runs when that clone is present and is skipped otherwise. It no longer points at fixtures in this repo. `todo.md` was deleted. The `.gitignore` comment is now a neutral one-line warning with no `todo.md` pointer. The two fixture ignore lines are kept, and an ignore line for a nested private clone was added. `AGENTS.md` Test Execution now gives the suite size as 19 files. It also has the user-approved paragraph on the golden stub, the override variable and the no-real-data rule. The commit touches 7 files. Both private term files return zero hits on HEAD, checked with canary-verified grep methods. The project file also returns zero hits. The suite passes with 19 of 19 files. All seven Phase 3 exit criteria are ticked in the project file, which is left modified but unstaged. No other tracked file refers to `todo.md`, and the README has no remaining reference to the in-repo fixture path.

Review fixes (2026-09-25, two `docs` commits)
This local commit fixes review findings 1 and 3 in `README.md`; no other file changed. The golden-test paragraph now says that `MT_PRIVATE_FIXTURES` can point to a private clone elsewhere, resolved against the repo root. It also says the golden test is skipped only when no private clone is found. A misconfigured `MT_PRIVATE_FIXTURES` value or an incomplete clone fails the test instead. `AGENTS.md` was not touched. The diff is one line, and CRLF line endings are kept. Both private term files return zero hits on `README.md`. The commit was not pushed. The project file is still modified with the Phase 3 exit-criteria ticks and is not staged; no criterion ticks changed in this fix.
In `AGENTS.md` `### Test Execution`, the sentence "An incomplete sibling clone is also an error." now follows the sentence about `MT_PRIVATE_FIXTURES`. This is a one-line diff with CRLF line endings kept, committed locally and not pushed.

Tests: pass (19 of 19 files on the scrub commit; the two follow-ups are prose-only). QA: SKIP (no `[QA]` annotation; docs and test-string edits only, covered by `npm test`).

### Phase 4: Rewrite history locally
**Goal**: A local history with no private term in any reachable blob or message, and a `HEAD` tree identical to Phase 3's.
**File scope**: `.git` only (refs, objects). No working-tree edits.

1. Preconditions: working tree clean; no `electron.exe` running. `PRE_HEAD` is the last local commit, whatever it is.
2. Rollback record, in the private repo's `scrub/rollback-note.md` (committed there before step 3): `PRE_HEAD`, `git rev-parse HEAD^{tree}` (`PRE_TREE`), the codex ref name and target, and `git ls-tree -r` listings of both tag commits. Then `git bundle create "$LOCALAPPDATA/mt-rewrite/mt-pre-rewrite-260925.bundle" --all` and `git bundle verify` it.
3. Ask the user to confirm deleting the codex ref (the Q8 reordering), then `git update-ref -d <refs/codex/… name>`.
4. Move `.git/filter-repo/` (leftover `already_ran` from 2026-09-19) into `$LOCALAPPDATA/mt-rewrite/` so filter-repo does not treat this as a continuation run.
5. Install `git-filter-repo` with pip (`--user`), and confirm `git filter-repo --version` works. If it is not on PATH, run it as `python -m git_filter_repo`.
6. Run: `git filter-repo --force --strip-blobs-with-ids <private>/scrub/strip-blob-ids.txt --replace-text <private>/scrub/replacements.txt --replace-message <private>/scrub/replacements.txt`.
7. Check `git remote -v`, and re-add `origin https://github.com/QuentinSylvestre/MeetingTranscriber.git` if filter-repo removed it `[unverified]`. Do **not** fetch.
8. Check the tree-identity criterion below **before** this step, because this step changes `HEAD`. Then remap SHAs written in files (Q9): build a map from the 2026-09-19 `commit-map` (moved aside in step 4) composed with this run's `.git/filter-repo/commit-map`. With a scratch script (not committed), find every 7-40 character hex token in `git ls-files` text files, match it by prefix against the map's old SHAs, and replace it with the new SHA truncated to the same length. List tokens that match no old SHA, or match several, and disposition each one (not a SHA, or ambiguous) in the private rollback note. Commit locally: `docs(260925_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB): phase 4 — remap commit references`.

> **Rejected:** `--path tests/unit/summary-golden.test.ts --invert-paths` — it also deletes the Phase 2 stub from HEAD. **Use instead:** `--strip-blobs-with-ids` on the old blob only.

**Exit criteria**:
- [x] Before step 8: `git rev-parse HEAD^{tree}` equals `PRE_TREE`.
- [x] After step 8: every hex token in tracked text files that was remapped resolves to a commit reachable from `main` (`git merge-base --is-ancestor <token> main`), and every unmatched token has a disposition in the private rollback note. The remap commit's diff touches only hex tokens.
- [x] Zero hits for both term files across `git grep … $(git rev-list --all)`, `git log --all --format=%B`, and `git for-each-ref refs/tags --format='%(contents)'`.
- [x] For each tag, `git ls-tree -r` differs from the recorded pre-rewrite listing only in paths that `replacements.txt` rules or the stripped blob touch.
- [x] Every `docs(<slug>)` and `feat(<slug>)` scope in `git log --format=%s` still names an existing plan file under `plans/` or `plans/done/`. (User: accepted 2026-09-25 as "no scope changed by the rewrite": 6 of 9 distinct scopes never named a plan file, because of archive renames and generic scopes.)
- [x] `git rev-list --all --objects` contains no id from `strip-blob-ids.txt`, nor either fixture blob id (`git hash-object` of each private fixture).
- [x] `git show-ref` lists only `refs/heads/main` and both tags. No `refs/remotes/*`, no `refs/codex`.
- [x] Both tags still point to commits whose version in `package.json` matches the tag (`git show v0.1.0:package.json | grep version`).
- [x] `npm test`: `Test Files 18 passed (18)`.
- [x] Both term files return zero hits over `HEAD` and over the remap commit's message.

Implementation (2026-09-25, code: SHAs withheld until Phase 6, per the public-file rule)
Phase 4 rewrote the local history. First, a rollback note and a verified full rollback bundle were saved, the tool checkpoint ref was deleted, and the previous filter-repo state was moved aside. git-filter-repo then ran once and exited cleanly, with no commits pruned. It stripped the old golden-test blob and applied the replacement rules to file contents and commit messages. The HEAD tree after the rewrite is byte-identical to the tree before it. A local commit then remapped the commit references written in tracked files. 132 references in 3 plan files were rewritten to the new ids, all reachable from main. The diff changes hex tokens only. 24 tokens were not commit ids and were left unchanged; none was ambiguous or pointed at a pruned commit. The term scans over every reachable blob, every commit message and the tag annotations found zero hits. No stripped or fixture blob id is reachable. Only main and the two tags remain as refs. Both tags keep their package versions, and each tag's tree changed only where a replacement rule or the stripped blob applies. The test suite passes with 19 of 19 files. The commit-scope check is left open: 6 of 9 scopes never named a plan file, and the rewrite changed none of them. The remote was not re-added, so it must be added again, without fetching, before Phase 5.

Tests: pass (19 of 19 files after the rewrite). QA: SKIP (no `[QA]` annotation; `.git` history only). Orchestrator follow-up: `origin` re-added at the user's request ("try again", 2026-09-25) with no fetch; the commit-scope criterion ticked on the user's acceptance ("accept", 2026-09-25).

### Phase 5: Publish the rewrite
**Goal**: The remote matches the rewritten local history, with the releases intact.
**File scope**: remote refs only.

1. Record each release's asset ids and `updated_at` (`gh release view <tag> --json assets`) into the private `scrub/rollback-note.md`.
2. Show the user the Phase 4 results. Ask for explicit confirmation to disable the `Release` workflow and force-push.
3. `gh workflow disable Release`. Then `git push --force origin main`, then `git push --force origin v0.1.0 v0.1.1`.
4. `git fetch origin`, then verify. After verification, ask the user to confirm and run `gh workflow enable Release`.
5. Check release bodies for private terms: `gh release view <tag> --json body` grepped with both term files. The installers are built from `dist`/`dist-electron` only and contain no fixtures.

**Exit criteria**:
- [x] `git ls-remote origin` shows `main` equal to local `HEAD`, and both tags (peeled `^{}`) equal to the local tag targets. No other refs.
- [x] `gh run list --workflow Release` shows no run created after the push.
- [x] `gh release view <tag> --json tagName,assets` for both tags lists the same asset ids and `updated_at` values as recorded in step 1. If a release lost its tag attachment, re-attach it with `gh release edit <tag> --tag <tag>`, then re-check.
- [x] Release bodies have zero term hits.
- [x] `gh workflow view Release` shows the workflow enabled again.
- [x] `gh api repos/QuentinSylvestre/MeetingTranscriber/contents/tests/unit/summary-golden.test.ts --jq .size` matches the local stub size.

Implementation (2026-09-25, code: none; orchestrator-run)
Every step of this phase was user-gated, so the orchestrator ran it in-session and did not dispatch a sub-agent. The pre-push asset ids, sizes, updatedAt values and the Release run count (2) went into the private rollback note. After the user confirmed ("Proceed"), the Release workflow was disabled, `main` was force-pushed, and then both tags were force-pushed. A fetch followed. `git ls-remote` matches the local `HEAD`, `main`, both tag objects and both peeled commits, and shows no other refs. The Release workflow still has 2 runs, and no run of any workflow was created on the push day. Both releases keep all 4 assets, with unchanged ids and updatedAt values. The release bodies are empty, so they have zero term hits. The remote stub is 771 bytes, which matches the local file. After the user confirmed ("Re-enable"), the workflow was re-enabled, and it is `active` with no new run.

Tests: not run (remote refs only; the pushed tree is byte-identical to the one that passed 19 of 19). QA: SKIP (no `[QA]` annotation).

### Phase 6: Local cleanup and exposure check
**Goal**: Remove local stale copies of private data, and record what GitHub still serves.
**File scope**: `$LOCALAPPDATA/mt-rewrite/` (bundle and old filter-repo metadata), `../meeting_transcriber-PRIVATE-BACKUP/`, `tests/fixtures/municipal-summary/` (gitignored), `.git` (reflog, unreachable objects, `.git/filter-repo/`).

1. Ask the user to confirm the deletions listed in File scope. The Downloads originals and the gitignored `out/municipal*` folders are **not** deleted (see Follow-up Work). Tell the user that OneDrive's recycle bin keeps the deleted backup folder until emptied (accepted under the OneDrive deferral).
2. Delete the confirmed items. Then `git reflog expire --expire=now --all` and `git gc --prune=now`.
3. Exposure check, read-only: for each id in `strip-blob-ids.txt`, the `git hash-object` of each private fixture, and `PRE_HEAD` from the rollback note, run `gh api repos/QuentinSylvestre/MeetingTranscriber/git/blobs/<id>` (or `/git/commits/<sha>`). Record served or not served in the private `scrub/exposure-check.md`. §9 says only "exposure check recorded privately on <date>".
4. Record progress for Phases 1-6 in this file, using post-rewrite SHAs only.
5. Offer the user, as a separate optional step, deleting the two old Release workflow runs (`gh run delete`), whose pages link pre-rewrite tag commits. Act only on an explicit yes.

**Exit criteria**:
- [x] The confirmed paths no longer exist (`[ -e <path> ]` false for each).
- [x] `git cat-file -e <id>` fails for every stripped and fixture blob id and for `PRE_HEAD`, and `git fsck --unreachable --no-reflogs` reports nothing.
- [x] `npm test`: `Test Files 18 passed (18)`, with the private repo still supplying the fixtures.
- [x] The exposure-check result is recorded privately, and §9 holds no SHAs.
- [x] Before pushing, both term files return zero hits over `HEAD` and over the new commit's message.
- [x] Commit: `docs(260925_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB): phase 6 — cleanup and exposure check`. Push `main` normally (not forced) after user confirmation.

Implementation (2026-09-25, code: none; orchestrator-run)
After the user confirmed "Delete all", the orchestrator deleted four things: the rollback folder outside OneDrive (the bundle plus the 2026-09-19 filter-repo metadata), the old backup folder, the gitignored local fixture copies, and this run's `.git/filter-repo/`. Before deleting, it checked that both fixtures were byte-identical in the local copy, the private working tree and the private remote. The reflog was then expired and `git gc --prune=now` run. `git fsck --unreachable --no-reflogs` reports nothing. `git cat-file -e` fails for the stripped blob, both fixture blobs and `PRE_HEAD`. `npm test` passes 19 of 19 files (232 tests), with the private repo supplying the fixtures. The read-only exposure check was recorded privately on 2026-09-25. At the user's request ("Delete both runs"), the two old Release workflow runs were deleted. Both releases still have their 2 assets.

Progress record with post-rewrite SHAs:
- Planning: intent `259c4e1`, plan and review `7738a19`, Q9 remap decision `8d07262`.
- Phase 1: progress `8990067` (private-repo work only).
- Phase 2: code `7640a63`, review fixes `047e1a6`, resolver test `1952465`, progress `0e82936`.
- Phase 3: scrub and docs `d49744b`, review fixes `27380b7` and `fdca886`, progress `c0fd313`.
- Phase 4: SHA remap `7fb8c77`, progress `4adf001`. The force-push published `4adf001` as `main`.
- Phase 5: progress `7972d31`.

Tests: pass (19 of 19 files). QA: SKIP (no `[QA]` annotation; local cleanup and a read-only API check).

## 6) Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Old objects stay fetchable by SHA on GitHub | Real data remains retrievable by anyone holding a SHA | Accepted (Q2). Made observable by Phase 6. Follow-up item 1. |
| Pre-purge clones exist | Copies cannot be recalled | Accepted residual. Follow-up item 1. |
| A replacement breaks a test | Red suite after the rewrite | HEAD scrub is tested in Phase 3 before the rewrite. Phase 4's tree-identity check proves the rewrite changed nothing at HEAD. |
| An incomplete term list leaves a leak | Private content survives in history | Phase 1 iterates to a fixed point, adds variants, and does a bounded manual read for paraphrases. Phase 3 runs a canary. Phase 4 re-greps all history, messages, and tag contents. |
| Irreversible push of a bad rewrite | Public history damaged | Rollback bundle (Phase 4). Push only after all Phase 4 criteria pass and the user confirms. |
| filter-repo removes `origin`, chokes on the tree ref, or resumes the 2026-09-19 run | Rewrite blocked or merged with stale maps | Codex ref deleted and `.git/filter-repo/` moved aside beforehand. `origin` checked and re-added without fetching. |
| A fresh private clone checks fixtures out with CRLF | Golden test hash fails | `* -text` in the private `.gitattributes`; Phase 1 checks the fresh clone's hash and line endings. |
| Tag force-push re-runs the Release workflow | Rebuilt or deleted releases; changed auto-update assets | Workflow disabled around the push (Phase 5); asset ids and timestamps compared before and after. |
| Releases detach from the moved tags | Auto-update breaks for installed clients | The 2026-09-19 precedent kept `v0.1.0` attached. Phase 5 verifies and re-attaches if needed. |
| Old commit SHAs published elsewhere (Actions run pages, push-event feed, SHAs in plan and memory text) | Discoverable pointers to still-fetchable old objects | Accepted under Q2 for GitHub-side pointers; optional old-run deletion in Phase 6. SHAs in current tracked files: remapped before the push (Q9, Phase 4 step 8); old SHAs in historical file versions accepted. |
| A future `/qdream` sweep or plan re-publishes private terms | New leak after the scrub | Proposed `AGENTS.md` rule (Phase 3). Follow-up item 6. |
| Private data leaks through this plan or its commit messages | New public leak | Public-file rule. Phase 4 greps commit messages. The plan file itself is in the grep scope. |
| The stub's top-level await or `.cjs` import misbehaves under vitest 5 | Suite fails to load | Probe-proven for top-level await and alias. The `.cjs` import is covered by Phase 2's exit criteria. |
| Other local clones become stale | Confusing pulls | User confirmed none matter (explore checkpoint, item 2). |

## 7) Verification

- `npm test` from the repo root (see `AGENTS.md` Test Execution for the Windows `npm_config_script_shell` workarounds). Expect 18 files: all passing with the sibling present, `17 passed | 1 skipped` when it is absent.
- History scan: `terms-literal.txt` with `-F -i` and `terms-regex.txt` with `-E -i`, over `git grep … $(git rev-list --all)`, `git log --all --format=%B`, and tag contents, all empty.
- Tree identity across the rewrite: `git rev-parse HEAD^{tree}` equals the recorded `PRE_TREE`.
- Remote: `git ls-remote origin`, `gh release view <tag> --json assets`.
- Exposure: the `gh api …/git/blobs/<id>` check from Phase 6 (read-only).
- Never run `npx electron scripts/summary-eval.cjs`: it makes paid requests. `node --check` only.

## 8) Documentation Updates

| Document | Update needed | Phase |
|---|---|---|
| `README.md` | Rewrite the golden-test paragraph for the private sibling repo and the skip behavior | 3 |
| `todo.md` | Delete (both items resolved) | 3 |
| `.gitignore` | Reword the fixture comment neutrally and drop its "See todo.md" pointer; keep the ignore lines | 3 |
| `AGENTS.md` `### Test Execution` | Add the private-tier note (user approval required) | 3 |
| `scripts/summary-eval.cjs` header comment | Name the private repo as the transcript source | 2 |
| Private repo `README.md` | Layout, discovery convention, LFS rule, `scrub/` contents | 1 (doc-table-only) |

Doc-impact dispositions (2026-09-25 scan): `AGENTS.md` and `vitest.config.ts` "16 files to 15" sentences are false-positive (historical accounts, still accurate). `src/main/summary/generate.ts` "golden meeting" size comment is false-positive (still true, since the meeting now lives in the private repo; it names nothing private).

## 9) Implementation Divergences from Plan

- Phase 1: `scrub/` uses the four files named in Design Decisions (`terms-literal.txt`, `terms-regex.txt`, `replacements.txt`, `strip-blob-ids.txt`) instead of the single `terms.txt` in the Phase 1 layout line. Design Decisions is authoritative. The v1 bundle is flattened one level.
- Phase 1: the visibility criterion was ticked on the orchestrator's `gh repo view` check (PRIVATE), not re-run by the sub-agent.
- Phase 1: the long recording's remux reports a container duration 0.04 s shorter than its source. The copy-remux drops the source's start offset; the packet stream hash and packet count are identical. The short clip matches exactly.
- Phase 1: plain `grep` in Git Bash needs `LC_ALL=C.UTF-8` to use the term files (non-ASCII patterns with `-i -F`). `git grep` is unaffected. Later phases set the locale.
- Phase 1: a few generic French test sentences overlapping the fixture wording, and (user decision 2026-09-25) two paraphrased agenda items in `summary-render.test.ts`, are kept and listed in the private README's keep-list.
- Phase 1: the fixture blob ids were added to the literal term list as a guard (full 40-character ids only). No `src/` rule exists, so no `src-rules-for-review` file was created.
- Phase 2: the stub uses a plain named ESM import of the `.cjs` resolver; the `createRequire` fallback was not needed. `summary-eval.cjs` exits with a new code 4 when the resolver throws or returns null, before the key is read.
- Phase 2: the resolver contract was tightened after review. An empty `MT_PRIVATE_FIXTURES` is an error, a relative value resolves against the repo root, the inside-repo guard compares real paths, and an existing sibling without the private module throws a path-free error instead of returning the folder.
- Phase 2: at the user's request (2026-09-25, review finding 6), a new test file `tests/unit/private-fixtures.test.ts` covers the resolver's set-variable branches. **The suite is now 19 files.** Every later "18 files" expectation in this plan reads as 19: `Test Files 19 passed (19)` with the sibling present, `18 passed | 1 skipped (19)` without it. Phase 3 updates the `AGENTS.md` count to 19.
- Phase 3: on this Git for Windows build, `git grep -E -f terms-regex.txt` gives false negatives for patterns with non-ASCII bracket expressions (canary: 1 of 2 seeded lines). `git grep -P` and `LC_ALL=C.UTF-8 grep -E` both match 2 of 2. `git grep -F` for the literal file is unaffected. **Every later regex-term check in this plan (Phase 4 history scan, Phase 5 release bodies, Phase 6 pre-push gate) uses `git grep -P` or `LC_ALL=C.UTF-8 grep -E`, never `git grep -E`.** The orchestrator re-ran the Phase 1 history scan with `-P`: same hit paths as before, so the Phase 1 rules stand.
- Phase 3: `README.md` keeps its generic opening sentence (Category 3 boundary); one of the 12 replacement rules matches only a commit message, so it has no HEAD hit.
- Phase 3: after review, `README.md` names the `MT_PRIVATE_FIXTURES` override and says the test is skipped only when no private clone is found. At the user's choice (2026-09-25, "Add the sentence"), `AGENTS.md` gains "An incomplete sibling clone is also an error." after the approved paragraph.
- Phase 4: filter-repo ran as `python -m git_filter_repo`, because the pip `--user` install did not put `git filter-repo` on PATH (the fallback in step 5). `git bundle create --all` accepted the tree ref, so no bundle fallback was needed.
- Phase 4: the permission classifier blocked the sub-agent from re-adding `origin` in step 7. The orchestrator re-added it on the user's explicit instruction, without fetching.
- Phase 4: the commit-scope criterion cannot hold literally. 6 of 9 distinct scopes never named an existing plan file, because of archive renames (one with a date bump), a year-prefixed slug variant, and two generic scopes. The scope set is identical before and after the rewrite. The user accepted "no scope changed by the rewrite" as the criterion's meaning on 2026-09-25.
- Phase 4: the remap left 24 tokens that are not commit ids unchanged: decimals, session-id fragments, and a CSS colour. They are dispositioned by class in the private rollback note.
- Phase 5: the orchestrator executed the phase in-session instead of through an implementation sub-agent. Every step was a user-gated remote action, and a separate reviewer verified the published state.
- Phase 5: both releases report `targetCommitish` as `main`, but they still resolve by tag. The release-body check passes trivially because both bodies are empty.
- Phase 6: the exposure check found the 3 stripped blobs and the old remote `main` commit still served by SHA. This is the residual accepted in Q2. `PRE_HEAD` was never pushed, so the old remote `main` stood in as the "pre-rewrite commit" probe. Details are in the private `scrub/exposure-check.md`.
- Phase 6: the per-phase review ran after the final push instead of before it, because the push is one of this phase's exit criteria. The Step 9 final review covers it.
- Process: user cycle-cap override "1 qreview cycle per phase" (default: up to 2 cycles), recorded per the Continuous Improvement rule.

## Follow-up Work (Deferred)

1. **Old objects on GitHub.** The pre-purge fixture blobs and the old golden-test blob may stay fetchable by SHA until GitHub garbage-collects them, and pre-purge clones cannot be recalled. The user declined a Support purge (Q2). Re-run the Phase 6 exposure check later if needed.
2. **Real-derived local output under gitignored `out/municipal*`.** Not in Q8's cleanup set. The user decides whether to move it to the private repo or delete it.
3. **Original reference-recording folder in Downloads.** The user deletes it (Q8).
4. **Synthetic public golden fixture (Tier 1).** Deferred. Reopen if the golden test should run on public clones or in CI.
5. **Git LFS.** Adopt it in the private repo the first time a recording would exceed 100 MB.
6. **Future writes to `plans/` and `memory/`.** `/qdream` and later plans write into this public repo from session transcripts. The proposed `AGENTS.md` rule covers it; a pre-push hook grepping the private term files would enforce it (not in scope).
7. **Commit subjects over 50 characters.** The plan-slug scope convention makes this plan's subjects exceed the 50-character governance limit; accepted as a convention conflict.

## Review Log

### 2026-09-25 -- Plan review (via /qplan, 1 cycle cap)

Standard effort, 3 personas (Architect with gap-critic lens, Senior engineer, Security auditor). 52 raw findings, merged to 26 (7 High, 13 Medium, 6 Low). 25 auto-resolved; 1 escalated, then resolved by the user (Q9). Cycle cap of 1 set by the user, so no re-review ran.

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | High | Tag force-push fires `release.yml`, which republishes and deletes duplicate releases (Arch, SE, Sec). | Fixed -- Phase 5 disables the workflow around the push and compares asset ids before and after. |
| 2 | High | SC 3, the resolver contract, and the Phase 2 criterion disagreed on the set-but-empty override (Arch, SE). | Fixed -- resolver throws when the override lacks the private module; SC 3 and Phase 2 aligned. |
| 3 | High | `/qdev` progress entries would write pre-rewrite SHAs into this public file (Arch, SE, Sec). | Fixed -- public-file rule bans SHAs during Phases 1-4; Phase 6 records progress with rewritten SHAs. |
| 4 | High | `core.autocrlf=true` checks fixtures out with CRLF, breaking the pinned hash (SE). | Fixed -- private `.gitattributes` has `* -text`; Phase 1 checks line endings in a fresh clone. |
| 5 | High | Old commit SHAs remain as text in plan and memory files after the rewrite, pointing at old objects (Sec). | Fixed -- user chose Q9 B: Phase 4 step 8 remaps current files before the push. |
| 6 | Medium | Tree-identity gate via `git diff $PRE_HEAD` can false-pass once old objects are pruned (Arch, SE, Sec). | Fixed -- compare `HEAD^{tree}` against a recorded `PRE_TREE`. |
| 7 | Medium | Expecting `refs/remotes/*` after the rewrite needs a fetch, which re-imports old history (Arch, SE). | Fixed -- no remote refs expected, and no fetch until after the Phase 5 push. |
| 8 | Medium | Leftover `.git/filter-repo/already_ran` may make filter-repo resume the 2026-09-19 run (Arch). | Fixed -- Phase 4 moves the folder aside first. |
| 9 | Medium | Only HEAD was verified; broad replacements could corrupt tag trees silently (Arch). | Fixed -- tag `ls-tree` listings recorded and compared; rules must be long specific literals. |
| 10 | Medium | Rollback bundle next to the repo creates a new OneDrive-synced copy of old history (Arch, Sec). | Fixed -- bundle goes to `$LOCALAPPDATA/mt-rewrite/`; OneDrive recycle-bin residual disclosed. |
| 11 | Medium | Codex-ref reordering of Q8 had no confirmation gate (Arch). | Fixed -- Phase 4 step 3 asks the user first. |
| 12 | Medium | "Recording exists" was a category 3 item, yet the stub and docs must state a private tier exists (Arch, Sec). | Fixed -- Category 3 boundary decision added; open to user veto. |
| 13 | Medium | Unbounded Phase 3 scope could edit `src/` without approval or dev-safety check (Arch, SE). | Fixed -- `src/` rules shown to the user; Development Safety precondition added. |
| 14 | Medium | The Phase 6 push had no term-grep gate (Arch). | Fixed -- zero-hit grep over HEAD and the new message before pushing. |
| 15 | Medium | No rule stopped Phase 2-3 commits from being pushed before the rewrite (Arch, SE). | Fixed -- "no push until Phase 5" decision and exit criteria. |
| 16 | Medium | Term derivation was seeded only from the golden test and misses English paraphrases (Sec). | Fixed -- variants plus a bounded manual read of related diffs and messages. |
| 17 | Medium | ERE grep over literal terms gives silent false negatives (Sec, SE). | Fixed -- split literal and regex term files, `-F`/`-E` with `-i`, canary check. |
| 18 | Medium | Test output, errors, and paths pasted into the plan or commits could leak (Sec). | Fixed -- public-file rule extended to outputs and briefs; resolver error must not echo paths. |
| 19 | Medium | `memory/MEMORY.md` and future plans can re-publish terms after the scrub (Sec). | Fixed -- proposed `AGENTS.md` rule widened; Follow-up item 6. |
| 20 | Medium | Plan text itself held a real figure and duration, and named the sensitive subjects (Sec). | Fixed -- figures removed; Intent wording generalized. |
| 21 | Low | `prune-packable: 0` gate was vacuous (Arch, SE). | Fixed -- `git cat-file -e` must fail for every stripped id. |
| 22 | Low | `.gitattributes` line had invalid multi-pattern syntax (SE). | Fixed -- one pattern per line. |
| 23 | Low | `.cjs` named import and `__dirname` in the config were unverified (Arch, SE). | Fixed -- explicit export shape, `createRequire` fallback, `import.meta.url` alias. |
| 24 | Low | Exposure check covered blobs only, not old commits (Arch). | Fixed -- one old commit added; result recorded privately. |
| 25 | Low | Release bodies, old Actions runs, and `.gitignore` nesting guard were uncovered (Sec). | Fixed -- release-body grep, optional run deletion, ignore line and resolver nesting check. |
| 26 | Low | Plan commit subjects exceed the 50-character limit (SE). | Fixed -- recorded as an accepted convention conflict in Follow-up item 7. |

Finding 5: the rewrite changes commit SHAs, but SHAs written as text inside plan files and `memory/MEMORY.md` stay as they were, so they point at pre-rewrite commits that GitHub still serves. Some predate the 2026-09-19 purge. Q9 options: A accept, B remap current files after the rewrite, C blank them in every historical blob. The user chose B on 2026-09-25.

### 2026-09-25 -- Implementation Review (after Phase 1, persona: Security auditor)

Implementation health: Green.
5 findings (0 High, 0 Medium, 5 Low).

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | Low | One timestamp replacement's output value was itself a real timestamp from the private transcripts. | Fixed -- replaced with a fictional value with zero hits in private data, history and terms. |
| 2 | Low | Term files lacked four names found only in the private documents, needed as a forward guard. | Fixed -- added as literal and regex terms after zero-hit checks on scopes and plan names. |
| 3 | Low | `summary-render.test.ts` keeps paraphrases of two real agenda items without names, places or dates. | User: accepted -- user chose "Keep, document" on 2026-09-25; added to the private keep-list. |
| 4 | Low | Phase 1 layout line names `scrub/terms.txt`, but Design Decisions and delivery use two term files. | Fixed -- recorded in §9 as a divergence. |
| 5 | Low | The reviewer wrote two scratch files with private hit lines outside its allowed write path, then deleted them. | Fixed -- disclosed and deleted by the reviewer; no residue. |

Reviewer independently simulated the rewrite over every reachable blob, message and tag: zero residual term hits, and no `src/` path touched. qvalidate phase-count passed (8 of 8). Cycle 2 skipped under the user's 1-cycle cap.

### 2026-09-25 -- Implementation Review (after Phase 2, persona: Senior engineer)

Implementation health: Green.
6 findings (0 High, 0 Medium, 5 Low, 1 Info).

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | Low | An empty `MT_PRIVATE_FIXTURES` counted as unset and fell back to the sibling, against the "set means strict" contract. | Fixed -- an empty value now throws a path-free error naming the variable. |
| 2 | Low | `isInside` treated a child folder whose name starts with two dots as outside the repo. | Fixed -- only `..` or a `..`-plus-separator prefix counts as outside. |
| 3 | Low | The inside-repo guard compared typed paths, so junctions, subst drives or short names could bypass it. | Fixed -- both sides compared by real path when the path exists. |
| 4 | Low | A relative `MT_PRIVATE_FIXTURES` resolved against the current directory, which differs between vitest and Electron. | Fixed -- relative values resolve against the public repo root. |
| 5 | Low | A sibling folder without the private module surfaced a loader error that prints an absolute path. | Fixed -- the resolver throws a path-free "found but incomplete" error. |
| 6 | Info | The resolver's throw paths had no automated test, only manual exit-criteria runs. | User: accepted -- user chose "Add a test file" on 2026-09-25; `tests/unit/private-fixtures.test.ts` added. |

The fixes touch a validation gate, which normally forces a Full-effort cycle-2 review; cycle 2 was skipped under the user's 1-cycle cap, and the implementer re-ran every Phase 2 exit check plus per-case probes instead. The Step 9 final review covers the resolver again.

### 2026-09-25 -- Implementation Review (after Phase 3, persona: Security auditor)

Implementation health: Green.
3 findings (0 High, 0 Medium, 1 Low, 2 Info).

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | Low | `README.md` said the golden test is skipped otherwise, but a bad override or incomplete clone throws. | Fixed -- README now says it is skipped only when no private clone is found. |
| 2 | Info | The `AGENTS.md` paragraph covered the bad-override error but not the incomplete-sibling error. | Fixed -- user chose "Add the sentence" on 2026-09-25; one sentence appended. |
| 3 | Info | `README.md` never named the `MT_PRIVATE_FIXTURES` override. | Fixed -- README names the override and its repo-root resolution. |

The reviewer confirmed zero term hits on HEAD with canary-verified methods, that every replacement literal is absent from HEAD (so the rewrite leaves the HEAD tree unchanged), that no rule's output feeds another rule, and that the test assertions stay consistent. Cycle 2 skipped under the user's 1-cycle cap.

### 2026-09-25 -- Implementation Review (after Phase 4, persona: Security auditor)

Implementation health: Green.
17 findings (0 High, 0 Medium, 4 Low, 13 Info). Reviewer verdict: GO for publishing.

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 3 | Low | 3 regex guard patterns and 22 literal terms had no positive canary in old history or fixtures. | Fixed -- orchestrator canary: 72 of 72 literal terms and 11 of 11 ASCII regex samples matched with both methods. |
| 12 | Low | `FETCH_HEAD` and this run's `.git/filter-repo/` maps hold old ids locally; none of them is pushed. | Fixed -- already in Phase 6 scope (reflog expire, gc, filter-repo metadata removal). |
| 13 | Low | The commit-scope criterion stays unticked and §9 had no Phase 4 entry explaining it. | Fixed -- §9 entry added; user accepted "no scope changed by the rewrite" on 2026-09-25 and it is ticked. |
| 15 | Low | The `npm test` criterion text says 18 files while §9 says 19; the reviewer did not re-run tests. | Fixed -- implementer ran `npm test` after the rewrite: 19 of 19 passed; §9 records the 19-file count. |

The 13 Info rows are confirmations, and the reviewer recommends no action for them:
- Zero term hits across all blobs, messages, tag annotations and path names. The canary run over the pre-rewrite bundle found hits.
- No stripped or fixture blob id is in the object store.
- `HEAD~1^{tree}` equals `PRE_TREE`.
- The remap changes hex only. All 29 old-to-new mappings match on subject, and no stale id is left in tracked text or messages.
- Both tags are annotated and keep their versions. Only `main` and the tags are refs, and every object is reachable.
- Identities and dates are unchanged.
- qvalidate passes.

Cycle 2 was skipped under the user's 1-cycle cap.

### 2026-09-25 -- Implementation Review (after Phase 5, persona: Security auditor)

Implementation health: Green.
5 findings (0 High, 0 Medium, 2 Low, 3 Info).

| # | Severity | Finding (one line) | Resolution (one line) |
|---|---|---|---|
| 1 | Low | 3 of 17 regex patterns match no private data, so their zero-hit scans are not canary-proven. | Fixed -- already done at the Phase 4 review: synthetic samples for all 11 ASCII patterns matched with both methods. |
| 2 | Low | The Phase 6 `npm test` criterion still says 18 files. | Fixed -- §9 states that every later "18 files" expectation reads as 19; Phase 6 is checked against 19. |
| 3 | Info | The two old Release run pages still reference pre-rewrite tag commits. | Fixed -- already covered by Phase 6 step 5 (optional run deletion) and the exposure check. |
| 4 | Info | Both releases report `targetCommitish` as `main`; they still resolve by tag. | Fixed -- recorded in §9 for future release edits. |
| 5 | Info | The release-body check passes trivially because the bodies are empty. | Fixed -- recorded in §9. |

The reviewer checked six things independently:
- The refs match.
- No run fired, and the workflow is active.
- All 4 assets are unchanged.
- The remote `main` tree equals the local `HEAD` tree.
- The remote commit list (159 commits) is identical to local history.
- The remote messages and tag annotations have zero term hits, confirmed with a canary.

Cycle 2 was skipped under the user's 1-cycle cap.

## Harness Improvement Opportunities

- `/qexplore` Step 1.5 has no trio for data-sweep or privacy-audit tasks. The mutation-finder brief had nothing to trace here, so the orchestrator swapped in a privacy-sweep agent. — cost: an off-script judgment call and a deviation recorded by hand — suggested change: add an optional "content-sweep" brief variant for tasks whose subject is data present in the tree or history rather than code flow.
- `/qexplore` writes project files to `plans/` without considering repo visibility. In a public repo, an exploration about private data can leak that data through its own intent file. — cost: the orchestrator had to invent a public-file rule mid-session — suggested change: add a Step 3 check: "if the repo is public and the subject is sensitive, write no sensitive literals; keep them in a private location."
- Council eligibility versus engaged-conversation opt-in is ambiguous for trade-off questions in `/qexplore`. `shared/AGENTS.md` says to invoke council before escalating, but the qcouncil opt-in table makes `/qexplore` opt-in, and only for oscillation. — cost: unclear whether Q1 should have been council-gated; it was offered as opt-in — suggested change: state explicitly whether `/qexplore` trade-off questions (not only oscillation) run council silently or offer it.
- `/qplan` requires phase-level code snippets and file:line citations, but this plan's most important content (the term list, replacement strings, blob ids) cannot appear in the plan at all, because the plan is public. — cost: the plan points to private-repo files instead of stating them, so reviewers cannot audit the actual rules — suggested change: let a plan declare an out-of-band artifact location for sensitive contract details, and have reviewers be told it exists.
- `/qdev` Step 7 expects `code: <sha>` in implementation notes and plan commits, but this plan's public-file rule bans pre-rewrite SHAs in the file during Phases 1-4. — cost: an ad-hoc "SHAs withheld" marker in notes and commit subjects — suggested change: let a plan declare "no SHAs until phase N" and have `/qdev` substitute a fixed placeholder that `commit-pairing` accepts.
- A permission classifier blocked a plan-approved sub-agent step (re-adding a git remote) mid-phase, and the orchestrator correctly could not perform it on the sub-agent's behalf. — cost: one user round-trip and a gap between the rewrite and the remote re-add — suggested change: when a plan phase contains a step a classifier may block (remote config, force operations), have `/qdev` pre-surface it to the user for an explicit instruction before dispatch, so the orchestrator can run it directly.
