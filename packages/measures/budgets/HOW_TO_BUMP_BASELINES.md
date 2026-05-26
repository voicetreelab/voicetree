# How to bump subgraph-health baselines

**Read this only if a human has explicitly approved bumping a baseline for the work in front of you.** Default expectation: an agent never bumps a baseline. Gate failures are tech-debt signals — the answer is FP-rearrange the change, not raise the threshold.

If you (the agent) are reading this without explicit human approval *in this conversation*, stop and ask. The `Baseline-bump-rationale:` trailer mechanism is a tool for humans, not an agent escape hatch.

---

## When a baseline bump is appropriate

Only the following situations:

1. The human said something like "go ahead and bump the baseline for X" in this conversation.
2. You have applied every relevant FP pattern from `~/brain/workflows/engineering/architectural-complexity/fp-rearchitecting/SKILL.md`, the regression remains, and the human has reviewed your analysis and approved the bump.
3. You are doing the per-merge baseline-refresh as part of a documented rebase/merge workflow the human has set up.

In every other case: surface the failure to the human, explain what FP patterns you tried, and ask. Do not bump.

## How the bump must be shaped

The pre-commit `baseline-commit-isolation` gate enforces these mechanically:

- The commit must touch ONLY files under `packages/measures/budgets/subgraph/...`. Mixing baselines with code is refused.
- The commit message must carry a `Baseline-bump-rationale: <text>` trailer where `<text>` is at least 20 characters and explains *why* the bump is justified — typically referencing the prior incident, the FP patterns already tried, and the specific human approval.

## Two valid mechanisms

### A. Full capture (default)

```
npm run measures:capture-baselines -- --i-am-sure --reason="<≥20 chars>"
```

This script:
- Runs every registered SubgraphMeasure over the entire working tree.
- Writes every `byCommunity` value in every `budgets/subgraph/<measure-id>.json`.
- Appends a row to `packages/measures/budgets/BASELINE_BUMP_LOG.md` with the reason.

Use this when the working tree state is clean enough to snapshot wholesale. **Do not use this when other agents have uncommitted WIP** — the script will lock peer's in-flight refactors into the new budgets without their consent.

### B. Surgical hand-edit (requires explicit human approval *for this specific use*)

Edit the specific community values in the specific `budgets/subgraph/<measure-id>.json` files that regressed. Commit the JSON edits alone with the `Baseline-bump-rationale:` trailer. Do not append to `BASELINE_BUMP_LOG.md` from a hand-edit (that log tracks scripted bumps).

Use this only when:
- Mechanism A would snapshot uncommitted peer work, AND
- The human has approved bumping *exactly the communities* you intend to edit.

If both conditions aren't met, do not hand-edit. Pause and ask.

## Rollback

If a bump landed and shouldn't have, revert the bump commit:

```
git revert <bump-commit-sha>
```

The revert restores the prior baselines without altering the code change. Then the original gate failure resurfaces and can be addressed properly.
