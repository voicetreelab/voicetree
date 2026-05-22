export const CHECK_TIERS = [
  {
    id: 'tier0',
    label: 'Tier 0',
    scope: 'Every commit',
    description: 'quick static checks + stop hooks',
  },
  {
    id: 'tier1',
    label: 'Tier 1',
    scope: 'Every push',
    description: 'push-gate E2E smoke checks',
  },
  {
    id: 'tier2',
    label: 'Tier 2',
    scope: 'Merge to main',
    description: 'full suites and slow/deep checks',
  },
]

const TIER0_CHECK_IDS = new Set([
  'blackbox-tests-lint',
  'circular-deps',
  'claude-stop-quality',
  'complexity',
  'coupling',
  'dead-code',
  'duplication',
  'e2e-taxonomy',
  'git-pre-commit',
  'root-lint',
  'verify-cytoscape-rules',
  'webapp-check',
  'webapp-lint',
])

const TIER1_CHECK_IDS = new Set([
  'e2e-tier1',
  'git-pre-push',
])

export function checkTierId(report) {
  if (report.details?.measureFolder === 'tier_1') return 'tier1'
  if (TIER0_CHECK_IDS.has(report.checkId)) return 'tier0'
  if (TIER1_CHECK_IDS.has(report.checkId)) return 'tier1'
  if (report.category === 'Lint' || report.category === 'TypeCheck') return 'tier0'
  if (report.category === 'E2E' && report.checkId.includes('tier1')) return 'tier1'
  return 'tier2'
}

export function bucketizeByTier(reports) {
  const byTier = Object.fromEntries(CHECK_TIERS.map(t => [t.id, []]))
  for (const report of reports ?? []) {
    byTier[checkTierId(report)].push(report)
  }
  return byTier
}
