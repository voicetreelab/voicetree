// Tier-4 precheck job. PR size + freshness of the last successful nightly
// Tier-4 carrier together gate Tier 4 on PRs into main.

import type {WorkflowSpec} from '../../src/checks/_workflow-types.ts'

import type {Job} from './_types.ts'

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
        'for sha in $(gh api "repos/$REPO/commits?sha=main&per_page=100" --jq \'.[].sha\'); do',
        '  LAST=$(gh api "repos/$REPO/commits/$sha/check-runs" \\',
        '         --jq \'.check_runs[] | select(.name=="Main CI / Full" and .conclusion=="success") | .completed_at\' \\',
        '         | head -n1)',
        '  [ -n "$LAST" ] && break',
        'done',
        '',
        'if [ -z "$LAST" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        '  echo "reason=no successful Main CI / Full found on main in last 100 commits" >> "$GITHUB_OUTPUT"',
        '  exit 0',
        'fi',
        '',
        'AGE_DAYS=$(( ( $(date +%s) - $(date -d "$LAST" +%s) ) / 86400 ))',
        'echo "last successful Main CI / Full on main: $LAST (${AGE_DAYS}d ago)"',
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
                name: 'decide',
                env: {
                    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
                    REPO: '${{ github.repository }}',
                    PR_NUMBER: '${{ github.event.pull_request.number }}',
                    LARGE_FLOOR: '1000',
                    LARGE_CEILING: '10000',
                    STALE_DAYS: '7',
                },
                run: decideScript,
            },
        ],
    }
}
