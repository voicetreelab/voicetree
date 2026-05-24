// Pure: hierarchy classification, utilization, leaf/aggregate construction.
// Mirrors mockups/ranking-hierarchy/_data.js > SUBGROUPS — re-derived here so
// the mockup folder stays a sandbox and this module is the live source of truth.

const CATEGORY_ORDER = ['Coupling','Complexity','Structure','Purity','Behavioral','Shape','Churn','Other']

const DISPLAY_NAME = { Other: 'Core' }
const displayName = (c) => DISPLAY_NAME[c] ?? c

const SUBGROUPS = {
  Behavioral: [
    { name: 'Globals',          match: (id) => id.startsWith('globals-') },
  ],
  Coupling: [
    { name: 'Cross-package',    match: (id) => id.startsWith('cross-package-') },
    { name: 'Boundary',         match: (id) => id.startsWith('boundary-') },
    { name: 'Hypergraph',       match: (id) => id.startsWith('hypergraph-') },
  ],
  Purity: [
    { name: 'AST-based',        match: (id) => id.startsWith('purity-ast-') },
    { name: 'Ratio-based',      match: (id) => id.startsWith('purity-ratio') },
    { name: 'Detection',        match: (id) => ['default-value-detection','package-boundaries'].includes(id) },
  ],
  Structure: [
    { name: 'DSM',              match: (id) => id.startsWith('dsm-') },
    { name: 'Graph topology',   match: (id) => ['graph-entropy','treewidth','modularity-q'].includes(id) },
    { name: 'Codebase scale',   match: (id) => id.startsWith('codebase-') },
  ],
  Shape: [
    { name: 'Exports',          match: (id) => id.startsWith('exports-') || id === 'shape-complexity-p90-exports' },
    { name: 'File complexity',  match: (id) => id.startsWith('shape-complexity-') && id !== 'shape-complexity-p90-exports' },
  ],
  Other: [
    { name: 'Ratchet gates',    match: (id) => id.includes('ratchet') },
  ],
}

export function utilization (r) {
  if (r.comparison === 'lte') {
    if (r.budget === 0) return r.current === 0 ? 0 : Infinity
    return r.current / r.budget
  }
  if (r.current === 0) return r.budget === 0 ? 0 : Infinity
  return r.budget / r.current
}
export const utilCapped = (u) => Number.isFinite(u) ? Math.min(u, 2) : 2

function leafStatus (r) {
  if (!r.passed) return r.severity === 'warning' ? 'warn' : 'fail'
  if (r.budget === 0) return 'gate-pass'
  if (utilization(r) >= 0.85) return 'caution'
  return 'pass'
}

function makeLeaf (r) {
  const u = utilization(r)
  // effectivePassed: warning-only metrics don't propagate failure to parent
  // aggregates — the leaf still shows the over-budget tile, but the category
  // header stays green.
  const effectivePassed = r.passed || r.severity === 'warning'
  return {
    kind: 'leaf',
    name: r.metricName,
    util: u,
    utilCapped: utilCapped(u),
    passed: r.passed,
    effectivePassed,
    status: leafStatus(r),
    report: r,
  }
}

function aggregate (children) {
  let maxU = 0
  let anyInfinite = false
  let allPass = true
  for (const c of children) {
    if (!(c.effectivePassed ?? c.passed)) allPass = false
    if (!Number.isFinite(c.util)) anyInfinite = true
    else if (c.util > maxU) maxU = c.util
  }
  const util = anyInfinite ? Infinity : maxU
  return { util, utilCapped: utilCapped(util), passed: allPass, effectivePassed: allPass }
}

export function buildHierarchy (reports) {
  const byCategory = new Map()
  for (const r of reports) {
    const cat = CATEGORY_ORDER.includes(r.category) ? r.category : 'Other'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat).push(r)
  }

  const categories = []
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory.get(cat)
    if (!items || items.length === 0) continue
    const rules = SUBGROUPS[cat] ?? []

    const buckets = new Map()
    const directReports = []
    for (const r of items) {
      const rule = rules.find((rl) => rl.match(r.metricId))
      if (rule) {
        if (!buckets.has(rule.name)) buckets.set(rule.name, [])
        buckets.get(rule.name).push(r)
      } else {
        directReports.push(r)
      }
    }

    const children = []
    for (const rule of rules) {
      const bucket = buckets.get(rule.name) ?? []
      // Subgroup only materialises when ≥ 2 metrics share it.
      if (bucket.length >= 2) {
        const leaves = bucket.map(makeLeaf)
        leaves.sort((a, b) => b.util - a.util)
        children.push({
          kind: 'subgroup',
          name: rule.name,
          children: leaves,
          ...aggregate(leaves),
        })
      } else if (bucket.length === 1) {
        directReports.push(bucket[0])
      }
    }
    for (const r of directReports) children.push(makeLeaf(r))
    children.sort((a, b) => b.util - a.util)

    categories.push({
      kind: 'category',
      name: displayName(cat),
      rawCategory: cat,
      children,
      ...aggregate(children),
    })
  }

  categories.sort((a, b) => b.util - a.util)
  return categories
}

export function collectLeaves (node) {
  if (node.kind === 'leaf') return [node]
  const out = []
  for (const c of node.children) out.push(...collectLeaves(c))
  return out
}
