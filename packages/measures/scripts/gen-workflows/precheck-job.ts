// Tier-4 precheck job. Gates Tier 4 on PRs by PR size and the freshness of
// the last successful Tier-4 run anywhere on this workflow.
//
// Freshness query: this workflow only fires on pull_request, so commit-keyed
// check-runs against main never carry a `tier-4-analyzers` entry. Instead we
// page recent successful runs of this workflow and look for the most recent
// one whose `tier-4-analyzers` job concluded success (skipped runs don't
// count). That timestamp is the staleness signal.

import type {WorkflowSpec} from '../../src/checks/_workflow-types.ts'

import type {Job} from './_types.ts'

const WORKFLOW_FILE = 'measures-budget-gate.yml'
const TIER_4_JOB_NAME = 'tier-4-analyzers'
const RUN_PAGE_SIZE = 20

export function precheckJob(jobId: string, trigger: WorkflowSpec['trigger']): Job {
    const decideScript = [
        'set -euo pipefail',
        'ADDED=$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq \'.additions // 0\')',
        'ADDED=${ADDED:-0}',
        'echo "PR added $ADDED lines"',
        '',
        'if [ "$ADDED" -lt "$LARGE_FLOOR" ]; then',
        '  echo "should_run=false" >> "$GITHUB_OUTPUT"',
        '  echo "reason=PR is small ($ADDED < $LARGE_FLOOR lines)" >> "$GITHUB_OUTPUT"',
        '  echo "::notice title=Tier 4 skipped::PR adds $ADDED lines (< $LARGE_FLOOR floor)"',
        '  exit 0',
        'fi',
        '',
        'if [ "$ADDED" -ge "$LARGE_CEILING" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        '  echo "reason=huge PR ($ADDED >= $LARGE_CEILING lines)" >> "$GITHUB_OUTPUT"',
        '  echo "::notice title=Tier 4 running::huge PR ($ADDED lines)"',
        '  exit 0',
        'fi',
        '',
        'LAST=""',
        `for run_id in $(gh api "repos/$REPO/actions/workflows/$WORKFLOW_FILE/runs?status=success&per_page=$RUN_PAGE_SIZE" --jq '.workflow_runs[].id'); do`,
        '  done_at=$(gh api "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" \\',
        '            --jq ".jobs[] | select(.name==\\"$TIER_4_JOB_NAME\\" and .conclusion==\\"success\\") | .completed_at" \\',
        '            | head -n1)',
        '  if [ -n "$done_at" ]; then',
        '    LAST="$done_at"',
        '    break',
        '  fi',
        'done',
        '',
        'if [ -z "$LAST" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        `  echo "reason=no successful $TIER_4_JOB_NAME found in last $RUN_PAGE_SIZE workflow runs" >> "$GITHUB_OUTPUT"`,
        '  exit 0',
        'fi',
        '',
        'AGE_DAYS=$(( ( $(date +%s) - $(date -d "$LAST" +%s) ) / 86400 ))',
        `echo "last successful $TIER_4_JOB_NAME: $LAST (\${AGE_DAYS}d ago)"`,
        'if [ "$AGE_DAYS" -gt "$STALE_DAYS" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        '  echo "reason=stale (${AGE_DAYS}d > ${STALE_DAYS}d) and PR is $ADDED lines" >> "$GITHUB_OUTPUT"',
        '  echo "::notice title=Tier 4 running::stale (${AGE_DAYS}d > ${STALE_DAYS}d)"',
        'else',
        '  echo "should_run=false" >> "$GITHUB_OUTPUT"',
        '  echo "reason=Tier 4 fresh (${AGE_DAYS}d <= ${STALE_DAYS}d) and PR under huge threshold" >> "$GITHUB_OUTPUT"',
        '  echo "::notice title=Tier 4 skipped::fresh (${AGE_DAYS}d old)"',
        'fi',
    ].join('\n')
    return {
        id: jobId,
        name: jobId,
        runsOn: 'ubuntu-latest',
        needs: [],
        ifExpr: trigger.baseRef ? `github.base_ref == '${trigger.baseRef}'` : null,
        strategy: null,
        outputs: {should_run: '${{ steps.decide.outputs.should_run }}', reason: '${{ steps.decide.outputs.reason }}'},
        steps: [
            {kind: 'checkout'},
            {
                kind: 'run',
                id: 'decide',
                name: 'decide',
                env: {
                    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
                    REPO: '${{ github.repository }}',
                    PR_NUMBER: '${{ github.event.pull_request.number }}',
                    WORKFLOW_FILE,
                    TIER_4_JOB_NAME,
                    RUN_PAGE_SIZE: String(RUN_PAGE_SIZE),
                    LARGE_FLOOR: '1000',
                    LARGE_CEILING: '10000',
                    STALE_DAYS: '7',
                },
                run: decideScript,
            },
        ],
    }
}
