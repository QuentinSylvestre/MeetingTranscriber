# Private fixture repo for the real-data golden test, and a history scrub of the public repo

> **Date**: 2026-09-25
> **Status**: Exploring
> **Scope**: Move the real-meeting golden test and all reference recordings/documents into a new private GitHub repo loaded through a public data-free stub, then rewrite the public repo's history so no real-meeting content or personal identifier remains in any reachable commit, tag, or commit message.

> **Public-file rule for this plan.** This file lives in a public repo and survives the rewrite. It must never contain a real name, quote, place name, meeting date, figure, fixture/blob SHA, or the leaked path itself. Those live only in the private repo (term list, replacement rules, SHA-check list).

---

## Intent

### Problem statement & desired outcomes

The public repo `QuentinSylvestre/MeetingTranscriber` still carries private content from a real municipal-council meeting, even after the 2026-09-19 fixture purge:

- `tests/unit/summary-golden.test.ts` embeds real speaker names, verbatim quotes, the real agenda with local place names, real figures and timestamps, the fixture's SHA-256, and a line naming off-topic personal subjects that include one person's health and legal-guardianship status.
- One archived plan contains an absolute Windows path exposing the author's username, employer, and the reference-recording folder name.
- Several test strings, plan lines, and commit messages carry lower-sensitivity meeting-derived details (meeting dates, agenda-item wording, the fact that a real recording exists).

The real fixtures and reference recordings/documents also have no versioned, access-controlled home: they sit in a gitignored folder, a local backup folder, and a Downloads folder.

Desired outcome: a private repo versions all real reference material and the real-data golden test. The public repo keeps an 18-file test suite in which the golden test runs when the private repo is present and shows as skipped otherwise. No reachable public commit, tag, or commit message contains private content.

### Success criteria

1. A private GitHub repo `QuentinSylvestre/MeetingTranscriber-private` exists and holds: the two golden fixtures, the current golden test body (moved unchanged except for `@src` imports), the reference-meeting audio (lossless `.m4a` remux), transcript text, both compte-rendu `.docx` files, the unzipped v1 bundle (expected `.docx`, spec, system and user prompts), the second meeting's audio and transcript, the two short test clips, the Phase 8 verification `.docx`, the history-scrub term list and replacement rules, and a short README.
2. `tests/unit/summary-golden.test.ts` in the public repo contains no private content. It resolves the private dir (`MT_PRIVATE_FIXTURES`, else the sibling `../meeting_transcriber-private`), dynamically imports the private test module when present, and registers a visible skip otherwise.
3. `npm test` reports 18 test files in both states: all passing with the sibling present, and 17 passing plus 1 skipped with it absent or `MT_PRIVATE_FIXTURES` pointing to an empty dir.
4. `scripts/summary-eval.cjs` finds the golden transcript through the same resolver instead of the hardcoded `tests/fixtures/...` path.
5. After the rewrite, a grep of every reachable blob and commit message on `main` and both tags (`git grep` over `git rev-list --all`, plus `git log --all --format=%B`) for the private term list returns zero hits. The term list is kept in the private repo.
6. Remote `main`, `v0.1.0`, and `v0.1.1` point to rewritten commits. Both GitHub releases still exist with their assets (`.exe`, `latest.yml`).
7. Local leftovers are gone: the pre-rewrite rollback bundle (after verification), `../meeting_transcriber-PRIVATE-BACKUP/` including the old bundle, the `refs/codex/...` checkpoint ref, and this clone's unreachable objects (reflog expire plus `git gc --prune=now`).
8. A read-only `gh api .../git/blobs/<sha>` check is documented and has been run once. It covers the old fixture blobs (SHA = `git hash-object` of each private fixture) and the old golden-test blob. The result is recorded, whether served or not.

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

---

## Exploration Discovery

<!-- Transient: /qplan folds these into the planning sections and removes this section. -->

### Existing patterns & constraints

- `AGENTS.md` Test Execution: run tests only through `npm test` (`pretest` rebuilds `better-sqlite3` for Node). "The suite is 18 files; a run reporting fewer means something is wrong." `git ls-files` confirms 18 `*.test.ts` files, all under `tests/unit/`.
- `AGENTS.md` Development Safety: confirm no `npm run dev` or `electron.exe` instance is running before touching `src/main/**`.
- `vitest.config.ts:25-29` sets only `exclude`. There is no `include`, alias, or env handling. Lines 4-8 hold a stale "16 to 15 files" comment.
- `tsconfig.json:14,16`: `paths: {}` and `include: ["src"]`. Tests are not type-checked, and tests import sources by relative path only.
- `tests/unit/summary-golden.test.ts:15-17` reads the fixtures at module scope through `new URL('../fixtures/...', import.meta.url)`. A `describe.skipIf` wrapper alone would not stop the import-time throw, which is why the design uses a stub with a dynamic import.
- `tests/unit/db.test.ts:61` is the existing `describe.skipIf` precedent.
- `scripts/summary-eval.cjs:47-48` hardcodes the golden transcript path. It is a paid, hand-run harness. Its outputs go to gitignored `scripts/.eval-output/`.
- Other references to the fixtures or the golden test: `.gitignore:15-18`, `README.md:123`, `todo.md:1-23`, `src/main/summary/generate.ts:8-9` (size metadata only), and the archived plan `plans/done/260919-0933_*` (fixture path and size, "18 files").
- `.github/workflows/release.yml` never runs `npm test`. The release builds only bundle `dist-electron`, `dist`, and `package.json` (`electron-builder.yml:7-13`), so no fixture ships in an installer.
- The 2026-09-19 rewrite left `.git/filter-repo/` metadata. `git-filter-repo` is no longer installed (not on PATH, not a Python module).

### Risks & mitigations

- **Old objects remain on GitHub.** Probes on 2026-09-25 showed GitHub still serves the pre-rewrite commit and the real transcript blob six days after the first purge. Accepted by the user (Q2). Mitigation: the SC 8 check makes the exposure observable.
- **Prior clones.** GitHub traffic showed 45 clones from 22 unique cloners in the 14 days to 2026-09-25, some possibly before the first purge. These copies cannot be recalled. Accepted residual risk.
- **Every other clone goes stale.** Nearly all SHAs change, because category 2 reaches back to 2026-09-15. The user confirmed no other clone matters (assumptions checkpoint, item 2).
- **Category 3 replacements could break tests.** The replacement strings must keep `summary-render.test.ts` assertions true. Gate: `npm test` at 18 files after the rewrite.
- **Order of operations.** The private repo must be pushed and verified before the rewrite or any deletion, and a rollback bundle must be taken before the rewrite. Every force-push, repo creation, and deletion needs a fresh user confirmation at execution time.
- **Leaking through this plan or commit messages.** See the public-file rule at the top. The same rule applies to every commit message this plan produces.
- **Release attachment after moving tags.** The 2026-09-19 rewrite already moved `v0.1.0`, and its release survived with assets. `[unverified]` beyond that precedent.

### Resolved decisions

- Q1: How is private data removed from GitHub (rewrite, force-push and Support purge, vs. delete and recreate the repo)? — A: A (rewrite and force-push, keep the repo) — Decision: rewrite history with filter-repo and force-push `main` and the tags. The repo keeps its URL and releases.
- Q2: Add a GitHub Support purge request, accepting that old objects otherwise stay fetchable by SHA? — A: "no support request, it's ok for a few days" — Decision: no Support request and no temporary private visibility. The residual exposure is accepted and made observable (SC 8).
- Q3: Where do the private-content assertions live (public stub plus private module, whole file private, or public test driven by a private expectations JSON)? — A: A — Decision: a public data-free stub `tests/unit/summary-golden.test.ts` dynamically imports the private test module. The existing test body moves unchanged apart from imports. The 18-file invariant holds.
- Q4 (revisited after a probe): How are recordings stored? — A: first "C" (audio-only in plain git); after the probe showed both `.mp4` files are already audio-only AAC at about 125 kbps, A — Decision: lossless remux to `.m4a` in plain git (about 69.5 MB for the reference meeting). Switch to LFS the first time a recording would exceed 100 MB.
- Q5: Which material goes into the private repo? — A: A — Decision: the whole reference-recording folder (both meetings, clips, both compte-rendu docs, unzipped v1 bundle, Phase 8 verification doc) plus the two golden fixtures. The redundant bundle `.zip` is dropped. The clips are treated as real data.
- Q6: How do the stub and the eval harness locate the private repo? — A: A — Decision: the sibling folder `../meeting_transcriber-private` by convention, with `MT_PRIVATE_FIXTURES` as an override, through one shared resolver. The OneDrive location is out of scope (user note).
- Q7: How far does the rewrite reach? — A: B — Decision: category 1 (remove the golden test path from all commits; the stub arrives as a new commit), category 2 (replace the leaked Windows path), and category 3 (replace meeting-derived dates and wording in tests, plans, and commit messages, in both history and HEAD). Replacement strings must keep the tests passing.
- Q8: What happens to local copies after verification? — A: B — Decision: take a rollback bundle before the rewrite. After verification, delete it, the old backup folder, the codex ref, and the unreachable objects. Keep the original reference-recording folder in Downloads for the user to delete.

### Open items

- Deterministic: the exact category 3 term list and replacement strings. Derive them from the privacy sweep's list plus a fresh `git grep` over all history. Store them in the private repo only, and check them against `summary-render.test.ts` assertions.
- Deterministic: the private repo layout (for example `fixtures/`, `recordings/`, `docs/`, `tests/summary-golden.private.ts`, `scrub/`) and the private module's fixture paths (relative to its own `import.meta.url`).
- Deterministic: the `git-filter-repo` install route (pip user install or a project venv per the Python venv rule) and the fresh-clone vs. `--force` requirement.
- Deterministic: where the shared resolver lives so both a `.ts` test and a `.cjs` script can use it (for example a small `.cjs` module under `scripts/` or `tests/`).
- Execution-contingent: whether GitHub keeps each release attached after the tags move. Verify with `gh release view` right after the force-push.

### Recommended approach

1. **Private repo first.** Create `MeetingTranscriber-private` (private) after user confirmation. Populate it from the backup folder, the gitignored fixtures, and the reference-recording folder. Remux the `.mp4` files to `.m4a` with `ffmpeg-static` using `-c:a copy`, and unzip the bundle. Copy in the current golden test as the private module with `@src` imports. Write the term list and replacement rules. Push, then verify with a fresh clone.
2. **Public stub and wiring.** Add an `@src` alias in `vitest.config.ts` (and fix the stale comment). Add the shared resolver. Replace `summary-golden.test.ts` with the stub. Point `summary-eval.cjs` at the resolver. Verify `npm test` in both states (SC 3), then commit.
3. **Docs.** Update `README.md:123` and `todo.md` (resolve both items), and remove or reword the `.gitignore` fixture lines if they become obsolete. Have `/qplan` propose the `AGENTS.md` Test Execution note about the private tier and the sibling convention.
4. **Rewrite.** Take a rollback bundle. Install `git-filter-repo`. Run a path removal for category 1 and `--replace-text` / `--replace-message` for categories 2 and 3, using the rules from the private repo. The stub commit re-adds the path afterwards, so run the rewrite in an order that keeps the new stub (for example, restrict the path removal to commits before the stub commit, or re-add the stub after the rewrite). `/qplan` should settle this ordering. Remove the codex ref. Run the SC 5 grep and `npm test`.
5. **Publish.** After explicit user confirmation, force-push `main` and both tags. Verify SC 6.
6. **Cleanup and exposure check.** After confirmation, delete the local leftovers (SC 7) and run the SC 8 blob probe.

### QA environment

- `npm test` from the repo root. On a `cmd.exe` PATH failure, apply the `npm_config_script_shell` workarounds in `AGENTS.md`. `better-sqlite3` is currently built for Node (rebuilt 2026-09-25 during exploration).
- Private tier toggling: remove or rename the sibling folder, or point `MT_PRIVATE_FIXTURES` to an empty dir, for the skipped state.
- History verification: `git grep -E '<terms>' $(git rev-list --all)` and `git log --all --format=%B | grep -E '<terms>'`, with the term list read from the private repo.
- GitHub (read-only): `git ls-remote origin`, `gh release view <tag> --json assets`, `gh api repos/QuentinSylvestre/MeetingTranscriber/git/blobs/<sha>`.
- Nothing needs the running Electron app. `summary-eval.cjs` makes paid API calls, so check it only by `node --check` or a dry path-resolution check, never a real run.

### Assumptions (unconfirmed)

None. The assumptions checkpoint was confirmed by the user ("ok").

---

## Harness Improvement Opportunities

- `/qexplore` Step 1.5 has no trio for data-sweep or privacy-audit tasks. The mutation-finder brief had nothing to trace here, so the orchestrator swapped in a privacy-sweep agent. — cost: an off-script judgment call and a deviation recorded by hand — suggested change: add an optional "content-sweep" brief variant for tasks whose subject is data present in the tree or history rather than code flow.
- `/qexplore` writes project files to `plans/` without considering repo visibility. In a public repo, an exploration about private data can leak that data through its own intent file. — cost: the orchestrator had to invent a public-file rule mid-session — suggested change: add a Step 3 check: "if the repo is public and the subject is sensitive, write no sensitive literals; keep them in a private location."
- Council eligibility versus engaged-conversation opt-in is ambiguous for trade-off questions in `/qexplore`. `shared/AGENTS.md` says to invoke council before escalating, but the qcouncil opt-in table makes `/qexplore` opt-in, and only for oscillation. — cost: unclear whether Q1 should have been council-gated; it was offered as opt-in — suggested change: state explicitly whether `/qexplore` trade-off questions (not only oscillation) run council silently or offer it.
