export const CHECK_TIERS = [
  {
    id: 'tier_0',
    label: 'Tier 0',
    scope: 'Every commit (pre-commit)',
    description: 'instant static + lint checks',
  },
  {
    id: 'tier_1',
    label: 'Tier 1',
    scope: 'Every push (pre-push)',
    description: 'unit + push-gate E2E smoke + health gates',
  },
  {
    id: 'tier_2',
    label: 'Tier 2',
    scope: 'Every PR (stage1 CI)',
    description: 'full unit + contract + browser E2E + fuzz',
  },
  {
    id: 'tier_3',
    label: 'Tier 3',
    scope: 'Merge to main + nightly',
    description: 'electron E2E + dead-code + duplication + mutation',
  },
]

const TIER_FROM_PATH = /\/checks\/(tier_[0-3])\//
const UNTIERED = 'untiered'

export function checkTierId(report) {
  const match = TIER_FROM_PATH.exec(report.details?.measurePath ?? '')
  return match ? match[1] : UNTIERED
}

export function bucketizeByTier(reports) {
  const byTier = Object.fromEntries(CHECK_TIERS.map(t => [t.id, []]))
  byTier[UNTIERED] = []
  for (const report of reports ?? []) {
    const id = checkTierId(report)
    if (!byTier[id]) byTier[id] = []
    byTier[id].push(report)
  }
  return byTier
}
