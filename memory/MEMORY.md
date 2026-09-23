# Project Memory — meeting_transcriber

## Feedback

### Show exact API cost, never an estimate

**Why**: User explicitly rejected estimated cost display in favor of exact per-request cost, confirmed by the resulting SC-5 exact-cost-tracking feature.
**How to apply**: For any new cost-surfacing UI or API-cost feature, query/derive the exact per-request cost (credits before/after, or a dedicated cost-query call) rather than an estimate.
**Source**: session e2d6bcee-bbb8-497a-a758-1fcf8d462556 | **Verified**: 2026-09-22 (sweep, anchor-reopen)

### User always overrides /qdev to 1 qreview cycle per phase

**Why**: Observed in 2/2 /qdev invocations for this project; a recurring (default, override) pair. The archived plan's own Harness section independently flags the cost of this override (unverified auto-fixes until Step 9).
**How to apply**: Default to 1 qreview cycle per phase for /qdev in this project unless the user says otherwise; consider noting this as a project-level default in AGENTS.md.
**Source**: session 015bcce6-ca7a-4076-8989-c86683a6a81a + session e2d6bcee-bbb8-497a-a758-1fcf8d462556 | **Verified**: 2026-09-22 (sweep, anchor-reopen)

## Decision

### No-license public distribution for MeetingTranscriber repo

**Why**: User deliberately chose all-rights-reserved over MIT/Apache/Polyform for the public GitHub repo, to allow personal use but block commercial use by others.
**How to apply**: When touching LICENSE/README/distribution-facing files, preserve the no-license/all-rights-reserved posture; do not add an OSS license without asking.
**Source**: session 6d1c2c1f-f60b-4461-9724-8a5b5ae7cb3b | **Verified**: 2026-09-22 (sweep, anchor-reopen)

## Pattern

### Capped-cost multi-model empirical testing before committing to an LLM model choice

**Why**: Before finalizing the summary feature's model, the user ran iterative, cost-capped empirical tests across multiple candidate models/effort levels rather than deciding from specs alone.
**How to apply**: For future LLM-model-selection decisions in this project, propose a capped-cost empirical test matrix (model x effort x repetitions) before committing, and surface cost/quality/comments per cell.
**Source**: session 84e3cb29-b4a1-42a2-b778-d4e21eabcd91 | **Verified**: 2026-09-22 (sweep, anchor-reopen)

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

### [improvement_signal] [QA] annotation on scaffold-only phases wastes a /qqa invocation

**Target**: `shared/skills/qplan/TEMPLATES.md`
**Why**: A phase annotated `[QA]` had no independently-exercisable automated runtime surface (pure scaffold + spike); `/qqa` returned SKIP with an annotation-mismatch note. Suggested: document that `[QA]` should be omitted from phases whose only verifiable output is "app opens" or "script runs successfully."
**Frequency**: 1 (below threshold) | **Sessions**: plan 260913-2146 | **Last observed**: 2026-09-13
**Evidence-quote**: "Phase 1 was annotated `[QA]` but has no independently-exercisable automated runtime surface (it is a pure scaffold + spike). QA returned SKIP with an annotation-mismatch note."

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
