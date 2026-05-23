// Real metric data captured from health-dashboard/reports/latest.json
// 49 metrics across 8 top-level categories.
// Used by every mockup view in this folder. Edit nothing here — change
// hierarchy rules in SUBGROUPS below if you want a different shape.

export const METRICS = [
  // ── Behavioral ────────────────────────────────────────────────
  {id:'behavioral-complexity',         name:'Behavioral Complexity',       category:'Behavioral', current:421,    budget:421,    comparison:'lte', passed:true,  unit:'score'},
  {id:'globals-console',               name:'Globals · console',           category:'Behavioral', current:147,    budget:147,    comparison:'lte', passed:true},
  {id:'globals-fs-io',                 name:'Globals · fs i/o',            category:'Behavioral', current:184,    budget:184,    comparison:'lte', passed:true},
  {id:'globals-network',               name:'Globals · network',           category:'Behavioral', current:17,     budget:17,     comparison:'lte', passed:true},
  {id:'globals-nondeterministic',      name:'Globals · nondeterministic',  category:'Behavioral', current:92,     budget:92,     comparison:'lte', passed:true},
  {id:'globals-process-io',            name:'Globals · process i/o',       category:'Behavioral', current:42,     budget:42,     comparison:'lte', passed:true},
  {id:'globals-react-hook',            name:'Globals · react hook',        category:'Behavioral', current:41,     budget:41,     comparison:'lte', passed:true},
  {id:'globals-subprocess',            name:'Globals · subprocess',        category:'Behavioral', current:14,     budget:14,     comparison:'lte', passed:true},
  {id:'globals-timer',                 name:'Globals · timer',             category:'Behavioral', current:70,     budget:70,     comparison:'lte', passed:true},

  // ── Churn ─────────────────────────────────────────────────────
  {id:'turbulence',                    name:'Turbulence',                  category:'Churn',      current:693,    budget:1,      comparison:'gte', passed:true},

  // ── Complexity ────────────────────────────────────────────────
  {id:'purity-ast-p90-function-loc',   name:'AST p90 function LOC',        category:'Complexity', current:38,     budget:40,     comparison:'lte', passed:true},
  {id:'cognitive-complexity',          name:'Cognitive Complexity',        category:'Complexity', current:1,      budget:1,      comparison:'lte', passed:true},
  {id:'function-health',               name:'Function Health',             category:'Complexity', current:0.79877,budget:0.5,    comparison:'gte', passed:true},
  {id:'hierarchical-complexity',       name:'Hierarchical Complexity',     category:'Complexity', current:272,    budget:272,    comparison:'lte', passed:true},

  // ── Coupling ──────────────────────────────────────────────────
  {id:'boundary-width-ratio',          name:'Boundary Width Ratio',        category:'Coupling',   current:1,      budget:1,      comparison:'lte', passed:true},
  {id:'change-coupling',               name:'Change Coupling',             category:'Coupling',   current:1,      budget:0.5,    comparison:'lte', passed:false},
  {id:'boundary-treewidth',            name:'Boundary Treewidth',          category:'Coupling',   current:3,      budget:3,      comparison:'lte', passed:true},
  {id:'cross-package-coupling',        name:'Cross-package Coupling',      category:'Coupling',   current:0,      budget:0,      comparison:'lte', passed:true},
  {id:'cross-package-cycles',          name:'Cross-package Cycles',        category:'Coupling',   current:0,      budget:0,      comparison:'lte', passed:true},
  {id:'hypergraph-bci',                name:'Hypergraph BCI',              category:'Coupling',   current:195.64, budget:195.64, comparison:'lte', passed:true},
  {id:'hypergraph-boundary-ratio',     name:'Hypergraph Boundary Ratio',   category:'Coupling',   current:1,      budget:1,      comparison:'lte', passed:true},
  {id:'hypergraph-pair-treewidth',     name:'Hypergraph Pair Treewidth',   category:'Coupling',   current:3,      budget:3,      comparison:'lte', passed:true},
  {id:'martin-instability',            name:'Martin Instability',          category:'Coupling',   current:1,      budget:1,      comparison:'lte', passed:true},
  {id:'passthrough-barrels',           name:'Passthrough Barrels',         category:'Coupling',   current:44,     budget:44,     comparison:'lte', passed:true},

  // ── Other (Gates) ─────────────────────────────────────────────
  {id:'gate-cognitive-baseline-ratchet',  name:'Gate · cognitive baseline',  category:'Other', current:0,   budget:0,  comparison:'lte', passed:true},
  {id:'gate-cognitive-threshold-ratchet', name:'Gate · cognitive threshold', category:'Other', current:103, budget:25, comparison:'lte', passed:false},
  {id:'gate-coupling-budget-ratchet',     name:'Gate · coupling budget',     category:'Other', current:0,   budget:0,  comparison:'lte', passed:true},
  {id:'gate-files-exist',                 name:'Gate · files exist',         category:'Other', current:0,   budget:0,  comparison:'lte', passed:true},

  // ── Purity ────────────────────────────────────────────────────
  {id:'purity-ast-health-score',           name:'AST · health score',         category:'Purity', current:0.32512, budget:0.3,   comparison:'gte', passed:true},
  {id:'purity-ast-pure-dir-side-effects',  name:'AST · pure-dir side-effects',category:'Purity', current:0,       budget:674.8, comparison:'lte', passed:true},
  {id:'purity-ratio-ast',                  name:'Ratio · ast',                category:'Purity', current:0.65025, budget:0.6,   comparison:'gte', passed:true},
  {id:'purity-ast-shell-thinness',         name:'AST · shell thinness',       category:'Purity', current:16,      budget:20,    comparison:'lte', passed:true},
  {id:'default-value-detection',           name:'Default Value Detection',    category:'Purity', current:12,      budget:0,     comparison:'lte', passed:false},
  {id:'package-boundaries',                name:'Package Boundaries',         category:'Purity', current:50,      budget:0,     comparison:'lte', passed:false},
  {id:'purity-ratio-pure-dir-side-effects',name:'Ratio · pure-dir s/e',       category:'Purity', current:0,       budget:674.8, comparison:'lte', passed:true},
  {id:'purity-ratio',                      name:'Ratio · overall',            category:'Purity', current:0.60992, budget:0.55,  comparison:'gte', passed:true},

  // ── Shape ─────────────────────────────────────────────────────
  {id:'exports-per-file-max',             name:'Exports per file · max',      category:'Shape', current:121, budget:121, comparison:'lte', passed:true},
  {id:'exports-per-file-p90',             name:'Exports per file · p90',      category:'Shape', current:10,  budget:10,  comparison:'lte', passed:true},
  {id:'shape-complexity-file-score',      name:'Shape · file score',          category:'Shape', current:62,  budget:363, comparison:'lte', passed:true},
  {id:'shape-complexity-p90-exports',     name:'Shape · p90 exports',         category:'Shape', current:10,  budget:10,  comparison:'lte', passed:true},
  {id:'shape-complexity-p90-file-p75-loc',name:'Shape · p90 file p75 LOC',    category:'Shape', current:48,  budget:48,  comparison:'lte', passed:true},

  // ── Structure ─────────────────────────────────────────────────
  {id:'codebase-directory-fanout',     name:'Codebase · directory fanout', category:'Structure', current:38,      budget:38,     comparison:'lte', passed:true},
  {id:'codebase-file-lines',           name:'Codebase · file lines',       category:'Structure', current:1081,    budget:1081,   comparison:'lte', passed:true},
  {id:'dsm-compression-ratio',         name:'DSM · compression ratio',     category:'Structure', current:0.40100, budget:0.8873, comparison:'gte', passed:true},
  {id:'dsm-layering',                  name:'DSM · layering',              category:'Structure', current:0,       budget:0,      comparison:'lte', passed:true},
  {id:'dsm-symmetric-cycles',          name:'DSM · symmetric cycles',      category:'Structure', current:0,       budget:0,      comparison:'lte', passed:true},
  {id:'graph-entropy',                 name:'Graph Entropy',               category:'Structure', current:0.87039, budget:0.953,  comparison:'gte', passed:true},
  {id:'treewidth',                     name:'Treewidth',                   category:'Structure', current:5,       budget:5,      comparison:'lte', passed:true},
  {id:'modularity-q',                  name:'Modularity Q',                category:'Structure', current:0.58424, budget:0.525,  comparison:'gte', passed:true},
]

// Semantic subgroup rules — inspired by what a `packages/measures/<cat>/<subgroup>/`
// folder layout would express. Each subgroup is a leaf in packages/measures'
// imagined hierarchy.
//
// A metric joins the FIRST subgroup whose match returns true. Anything
// unmatched lands in the special '·' (direct) bucket — rendered without an
// extra hierarchy level so the visualization stays honest.
const SUBGROUPS = {
  Behavioral: [
    { name: 'Globals',              match: id => id.startsWith('globals-') },
  ],
  Coupling: [
    { name: 'Cross-package',        match: id => id.startsWith('cross-package-') },
    { name: 'Boundary',             match: id => id.startsWith('boundary-') },
    { name: 'Hypergraph',           match: id => id.startsWith('hypergraph-') },
  ],
  Purity: [
    { name: 'AST-based',            match: id => id.startsWith('purity-ast-') },
    { name: 'Ratio-based',          match: id => id.startsWith('purity-ratio') },
    { name: 'Detection',            match: id => ['default-value-detection','package-boundaries'].includes(id) },
  ],
  Structure: [
    { name: 'DSM',                  match: id => id.startsWith('dsm-') },
    { name: 'Graph topology',       match: id => ['graph-entropy','treewidth','modularity-q'].includes(id) },
    { name: 'Codebase scale',       match: id => id.startsWith('codebase-') },
  ],
  Shape: [
    { name: 'Exports',              match: id => id.startsWith('exports-') || id === 'shape-complexity-p90-exports' },
    { name: 'File complexity',      match: id => id.startsWith('shape-complexity-') && id !== 'shape-complexity-p90-exports' },
  ],
  Other: [
    { name: 'Ratchet gates',        match: id => id.includes('ratchet') },
  ],
  // Complexity, Churn: no subgroups — leaves attach to category directly.
}

// ── Utilization (mirror of health-dashboard/app.js) ──────────────────────────
export function utilization (r) {
  if (r.comparison === 'lte') {
    if (r.budget === 0) return r.current === 0 ? 0 : Infinity
    return r.current / r.budget
  }
  if (r.current === 0) return r.budget === 0 ? 0 : Infinity
  return r.budget / r.current
}
export const utilCapped = u => (Number.isFinite(u) ? Math.min(u, 2) : 2)

// status: 'pass' | 'fail' | 'gate-pass' (budget === 0 passing — special)
export function status (r) {
  if (!r.passed) return 'fail'
  if (r.budget === 0) return 'gate-pass'
  return 'pass'
}

// ── Tree builder ─────────────────────────────────────────────────────────────
//
// Output shape:
//   [
//     { name, depth: 0, kind: 'category', util, passed, children: [
//         { name, depth: 1, kind: 'subgroup', util, passed, children: [ leaf, leaf, ... ] },
//         { name, depth: 1, kind: 'leaf', leaf },
//     ] }
//   ]
//
// Aggregation rule: parent.util = MAX(child.util)  (worst-first principle).
// parent.passed = AND(child.passed).

export function buildTree (metrics) {
  const byCategory = {}
  for (const m of metrics) (byCategory[m.category] ||= []).push(m)

  const categoryOrder = ['Coupling','Complexity','Structure','Purity','Behavioral','Shape','Churn','Other']
  return categoryOrder
    .filter(c => byCategory[c])
    .map(catName => {
      const inCat = byCategory[catName]
      const rules = SUBGROUPS[catName] ?? []

      // Bucket each leaf into a subgroup (or direct).
      const buckets = new Map()  // subgroupName -> leaves[]
      const direct  = []
      for (const m of inCat) {
        const rule = rules.find(r => r.match(m.id))
        if (rule) {
          if (!buckets.has(rule.name)) buckets.set(rule.name, [])
          buckets.get(rule.name).push(m)
        } else {
          direct.push(m)
        }
      }

      const children = []

      // subgroup children — preserve declaration order from SUBGROUPS
      for (const rule of rules) {
        const leaves = buckets.get(rule.name)
        if (!leaves || leaves.length === 0) continue
        const subNode = {
          kind: 'subgroup',
          depth: 1,
          name: rule.name,
          children: leaves.map(leafNode),
          ...aggregate(leaves),
          count: leaves.length,
        }
        children.push(subNode)
      }
      // direct leaves under category, sorted worst-first
      direct.sort((a,b) => utilization(b) - utilization(a))
      for (const m of direct) children.push(leafNode(m))

      // sort subgroups + direct by util desc (worst-first), stable
      children.sort((a,b) => b.util - a.util)

      return {
        kind: 'category',
        depth: 0,
        name: catName,
        children,
        ...aggregate(inCat),
        count: inCat.length,
      }
    })
}

function leafNode (m) {
  const u = utilization(m)
  return {
    kind: 'leaf',
    depth: 2,
    name: m.name,
    metric: m,
    util: u,
    utilCapped: utilCapped(u),
    passed: m.passed,
    status: status(m),
  }
}

function aggregate (leaves) {
  let maxU = -Infinity
  let anyFail = false
  for (const m of leaves) {
    const u = utilization(m)
    if (Number.isFinite(u) && u > maxU) maxU = u
    else if (!Number.isFinite(u) && maxU < Infinity) maxU = u
    if (!m.passed) anyFail = true
  }
  return {
    util: maxU,
    utilCapped: utilCapped(maxU),
    passed: !anyFail,
  }
}

// Convenience formatter — same convention as app.js
export const fmtUtil = u => Number.isFinite(u) ? `${u.toFixed(2)}×` : '∞×'
export const fmtNum = n => Number.isInteger(n) ? String(n) : Number(n).toFixed(3).replace(/\.?0+$/,'')
