# Project Memory — meeting_transcriber

## Feedback

### Show exact API cost, never an estimate

**Why**: User explicitly rejected estimated cost display in favor of exact per-request cost, confirmed by the resulting SC-5 exact-cost-tracking feature.
**How to apply**: For any new cost-surfacing UI or API-cost feature, query/derive the exact per-request cost (credits before/after, or a dedicated cost-query call) rather than an estimate.
**Source**: session e2d6bcee-bbb8-497a-a758-1fcf8d462556 | **Verified**: 2026-09-22 (sweep, anchor-reopen)

### In Claude Code, the user overrides /qplan and /qdev to 1 qreview cycle per phase

**Why**: Observed in 3/3 /qdev invocations and the matching /qplan run for this project; a recurring (default, override) pair. The user scoped it to Claude Code on 2026-09-28: Kiro sessions run qreview at maximum effort.
**How to apply**: In Claude Code, default to 1 qreview cycle per phase for /qplan and /qdev in this project unless the user says otherwise; in Kiro, keep the maximum-effort review default.
**Source**: session 015bcce6-ca7a-4076-8989-c86683a6a81a + session e2d6bcee-bbb8-497a-a758-1fcf8d462556 + plan 260925_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB § 9 (Process line) | **Verified**: 2026-09-28 (human:quentin, plan-scan)

### MeetingTranscriber's users are non-technical: fix known UX quirks rather than leaving them as noted issues

**Why**: When the agent listed two cosmetic or edge-case quirks it had chosen to leave, the user told it to fix them because the app is used by non-technical people and must be polished.
**How to apply**: Do not present a user-visible quirk (layout glitch, mixed state, race window) as acceptable residue; fix it in the same change or escalate it as a defect. (The agent also localized English-only main-process dialogs on its own initiative; that was not part of the user's instruction.)
**Source**: session cb759486-675c-407e-af62-f06cdff88e2f L1241 | **Verified**: 2026-10-09 (sweep, anchor-reopen)
**Evidence-quote**: "quirks: fix, app is used by non-technical people, it should be polished"


## Decision

### User declined a GitHub Support purge after the history rewrite, twice

**Why**: The user accepted the residual on GitHub's side at Q2 on 2026-09-25 and reconfirmed on 2026-09-28 ("B without a re-check, it's ok") after a Full council voted 4-0 for a purge; re-proposing without new facts costs a round-trip.
**How to apply**: Do not re-propose a GitHub Support purge for this repo's rewritten history unless the exposure facts change; the private repo's `scrub/exposure-check.md` holds the details.
**Source**: plan 260925_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB § Post-Implementation Review, finding 1 | **Verified**: 2026-09-28 (human:quentin)

### Public MeetingTranscriber repo is licensed PolyForm Noncommercial 1.0.0

**Why**: The user wanted the public GitHub repo to allow personal use but block commercial use by others; "no license" was only the repo-creation dropdown choice, and PolyForm Noncommercial 1.0.0 was committed as the licence (`LICENSE.md` line 1, commit bd95fda, 2026-09-19).
**How to apply**: When touching `LICENSE.md`, `package.json`'s `license` field, the README or other distribution-facing files, keep PolyForm Noncommercial 1.0.0; do not switch to an OSI licence (MIT/Apache) without asking.
**Source**: session 6d1c2c1f-f60b-4461-9724-8a5b5ae7cb3b + jsonl L104 + `LICENSE.md` L1 (bd95fda) | **Verified**: 2026-09-28 (sweep, artifact-check)
**Evidence-quote**: "or should I not pick a license and just commit a polyform license file in our first commit?"

## Pattern

### Capped-cost multi-model empirical testing before committing to an LLM model choice

**Why**: Before finalizing the summary feature's model, the user ran iterative, cost-capped empirical tests across multiple candidate models/effort levels rather than deciding from specs alone.
**How to apply**: For future LLM-model-selection decisions in this project, propose a capped-cost empirical test matrix (model x effort x repetitions) before committing, and surface cost/quality/comments per cell.
**Source**: session 84e3cb29-b4a1-42a2-b778-d4e21eabcd91 | **Verified**: 2026-09-22 (sweep, anchor-reopen)

### Force-pushing release tags re-triggers release.yml — disable the Release workflow around any tag rewrite

**Why**: The tag-triggered Release workflow rebuilds and republishes releases and deletes "duplicate" ones, so force-pushing a version tag would replace the assets the auto-updater reads; the history-scrub plan's review caught this before the push.
**How to apply**: Before any operation that moves or re-pushes a version tag, record the release asset ids, run `gh workflow disable Release`, push, re-enable it, then confirm the asset ids are unchanged.
**Source**: plan 260928-1133_PRIVATE_FIXTURE_REPO_AND_HISTORY_SCRUB § Phase 5 + session 5e26e1dd-0628-4bff-8428-50d4d1ab63d0 L635 | **Verified**: 2026-09-28 (sweep, anchor-reopen)
**Evidence-quote**: "**Force-pushing the tags would have re-run the Release workflow.** That workflow rebuilds and republishes the releases and deletes \"duplicate\" ones, which would replace the files auto-update checks."

### [improvement_signal] qvalidate commit-pairing check only matches first "phase N" occurrence

**Target**: `shared/skills/qdev/SKILL.md`
**Why**: A [P:N] parallel group's two phases combined into one docs commit mentioning both phase numbers only got the first credited by qvalidate's regex (`[regex]::Match`, not `Matches`), silently failing the second phase and requiring a follow-up commit — independently verified: `qvalidate.ps1` lines 707/716 both use `[regex]::Match`, which returns only the first match. Suggested: use `[regex]::Matches` or check each phase number independently.
**Frequency**: 1 (below threshold) | **Sessions**: plan 260919-0933_TRANSCRIBE_DEFAULT_PAGE_COST_TRACKING_DOCX_PERSISTENCE | **Last observed**: 2026-09-19
**Evidence-quote**: "the check only matches the FIRST \"phase N\" occurrence in a subject via `[regex]::Match` (not all occurrences), so it silently only credited phase 4 and failed on phase 5, requiring a small follow-up commit"

### [improvement_signal] Sub-agent commit carried banned Claude-Session trailer despite explicit brief instruction, 3x

**Target**: `shared/skills/qdev/SKILL.md`
**Why**: A sub-agent's commit carried the banned Claude-Session trailer despite an explicit brief instruction not to, three separate times in one session, each requiring a user-approved one-off amend to strip. Suggested: the orchestrator performs the final `git commit` itself (sub-agent stages + writes message to scratch file) rather than delegating the commit step to implementation sub-agents.
**Frequency**: 1 (below threshold) | **Sessions**: plan 260919-0933_TRANSCRIBE_DEFAULT_PAGE_COST_TRACKING_DOCX_PERSISTENCE | **Last observed**: 2026-09-19
**Evidence-quote**: "three separate user interruptions to authorize an amend, plus the orchestrator's own verification overhead each time"

### [improvement_signal] qvalidate doc-updates check can't distinguish never-addressed from resolved-conditional

**Target**: `shared/skills/qvalidate/SKILL.md`
**Why**: A Documentation Updates row worded conditionally ("update only if X") that resolved to no-change-needed reads identically to a genuinely-unaddressed requirement — both FAIL the same mechanical check (whether a commit touched the named file). Independently confirmed: qdev/SKILL.md's ≤25-word Finding/Resolution cap makes this ambiguity worse since there's no room to disambiguate inline.
**Frequency**: 1 (below threshold) | **Sessions**: plan 260919-0933_TRANSCRIBE_DEFAULT_PAGE_COST_TRACKING_DOCX_PERSISTENCE era | **Last observed**: 2026-09-19
**Evidence-quote**: "`qvalidate`'s `doc-updates` check can't distinguish \"this Documentation Updates row states a requirement that was never addressed\" from \"this row states a conditional check that was actually run and resolved to no-change-needed\""

### [improvement_signal] /qexplore one-question-at-a-time rule enforced only by instruction, not mechanically

**Target**: `shared/skills/qexplore/SKILL.md`
**Why**: A session had several multi-question turns before a user correction; independently re-checked current `shared/skills/qexplore/SKILL.md` — no mechanical/hook-level enforcement exists, only prose instruction. Suggested: enforce at the tool/session-submission-hook level, not only via governance instruction.
**Frequency**: 1 (below threshold) | **Sessions**: plan 260913-2146 | **Last observed**: 2026-09-13
**Evidence-quote**: "the harness could enforce it at the tool level, not just by governance instruction. Cost: unclear. Suggested change: add a one-question-at-a-time check to the session-submission hook."

### [improvement_signal] CANDIDATE_ARCHETYPE: environment capability claim contradicts session precedent

**Target**: `shared/skills/qdream/failure-archetypes.md`
**Why**: A fix sub-agent concluded live CDP verification "does not" work for an Electron app after grepping only `src/`, missing that a *dependency* (`vite-plugin-electron`) implements it — despite five prior sub-agents in the same session having already used the technique successfully. The orchestrator had to redo the verification independently.
**Frequency**: 1 (below threshold) | **Sessions**: plan 260919-0933_TRANSCRIBE_DEFAULT_PAGE_COST_TRACKING_DOCX_PERSISTENCE | **Last observed**: 2026-09-19
**Evidence-quote**: "it never checked whether a *dependency* (`vite-plugin-electron`) implements the feature, and this exact technique had already been used successfully by five prior sub-agents in this same session"

### [improvement_signal] CANDIDATE_ARCHETYPE: access restriction inferred from single error signature

**Target**: `shared/skills/qdream/failure-archetypes.md`
**Why**: Agent's AskUserQuestion asserted an OpenAI project "only has access to gpt-4o — none of the gpt-5.6 models" based on `model_not_found` errors for three model-name variants; the user rejected the tool call and disproved the restriction claim with a dashboard screenshot. Root cause was plausibly wrong/non-existent model ID strings, not an access restriction.
**Frequency**: 1 (below threshold) | **Sessions**: 84e3cb29-b4a1-42a2-b778-d4e21eabcd91 | **Last observed**: 2026-09-17
**Evidence-quote**: "The OpenAI project tied to the app's stored key only has access to gpt-4o — none of the gpt-5.6 models (including gpt-5.6-sol, which is the production feature's hardcoded model)."

## Declined

- "[improvement_signal] /qclose Pass 2 does not check whether a harness item's suggested change already exists in governance" — declined 2026-10-05 (no reason given)
