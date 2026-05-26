# Baseline bump log

Append-only audit trail for `packages/measures/budgets/subgraph/` refreshes.
Every line below corresponds to one authorized run of
`npm run measures:capture-baselines -- --i-am-sure --reason="…"`.

Reviewers can grep `git log -- packages/measures/budgets/BASELINE_BUMP_LOG.md`
to see who refreshed what and why. If a baseline change lands without a row
appended here, that change went through the wrong path — investigate.

## Entries

- 2026-05-25T15:11:14.192Z · Manu Masson <manummasson8@gmail.com> · Disk-reconciliation feature: Pattern 1 placement of reconcileGraphWithDisk at the application/ shell (commits 8314f286, 29d57290, 5870d32e) bumps application/ by +2 implicit-globals (fs.access) and +2 boundary-width (new daemon endpoint + workflow). Also captures CSV history writer (c4192b93) which legitimately adds fs+child_process+path to _shared/writers/. Both are load-bearing shell additions; FP rearrangement does not eliminate the cost.
- 2026-05-26T03:46:45.694Z · Manu Masson <manummasson8@gmail.com> · Add tier_3/analyzers/ with two mutation-incremental CheckDefs (+_workflow override). Three new exports in the measures/checks community — natural growth from adding two new tier-3 checks; no rearchitect available since one-file-per-CheckDef is the established discovery pattern for gen-workflows.ts.
