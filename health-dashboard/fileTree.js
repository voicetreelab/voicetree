import { esc } from './format.js'

// Heat thresholds (per-file): how many distinct metrics must flag a file to bump severity.
const HEAT_YELLOW = 1
const HEAT_ORANGE = 2
const HEAT_RED    = 4

// Cap on how many tree rows (file + dir summaries) are visible by default.
// Top-level dirs are always visible; opening a dir adds its (post-prune) children
// to the count. Greedy-debt expansion stops as soon as the next reveal won't fit.
const MAX_VISIBLE_NODES = 10

const SEVERITY_ORDER = { green: 0, yellow: 1, orange: 2, red: 3 }

// ── Extraction ────────────────────────────────────────────────────────────────

function stripAbsRepoPrefix(p) {
  const marker = '/voicetree-public/'
  const i = p.indexOf(marker)
  return i >= 0 ? p.slice(i + marker.length) : p
}

function isLikelyRepoPath(p) {
  if (typeof p !== 'string' || !p) return false
  if (p.startsWith('/')) return false
  return /^[a-z0-9_.-]+\//i.test(p) || /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html)$/i.test(p)
}

// Pull `{path, isDir}` items out of a single report's `details`. Each occurrence
// counts as one "flag" from that metric — duplicates within one report collapse
// because we de-dupe by (metricId, path) downstream.
function extractFlagPaths(report) {
  const d = report.details
  if (!d || typeof d !== 'object') return []
  const out = []

  if (Array.isArray(d.violations)) {
    for (const v of d.violations) {
      if (typeof v?.file === 'string') out.push({ path: v.file, isDir: false })
      else if (typeof v?.directory === 'string') out.push({ path: v.directory, isDir: true })
    }
  }

  if (Array.isArray(d.topFiles)) {
    for (const f of d.topFiles) {
      if (typeof f?.file === 'string') out.push({ path: f.file, isDir: false })
    }
  }

  for (const key of ['topFunctions', 'topLongestFunctions', 'longestFunctions']) {
    if (!Array.isArray(d[key])) continue
    for (const f of d[key]) {
      if (typeof f?.file === 'string') out.push({ path: f.file, isDir: false })
    }
  }

  if (Array.isArray(d.findings)) {
    for (const f of d.findings) {
      if (typeof f?.file === 'string') {
        out.push({ path: f.file, isDir: false })
      } else if (typeof f?.functionName === 'string') {
        const idx = f.functionName.indexOf('::')
        const raw = idx >= 0 ? f.functionName.slice(0, idx) : f.functionName
        const rel = stripAbsRepoPrefix(raw)
        if (rel) out.push({ path: rel, isDir: false })
      }
    }
  }

  if (Array.isArray(d.functions)) {
    for (const f of d.functions) {
      if (typeof f?.file === 'string') out.push({ path: f.file, isDir: false })
    }
  }

  if (Array.isArray(d.largestFiles)) {
    for (const f of d.largestFiles) {
      if (typeof f?.file === 'string') out.push({ path: f.file, isDir: false })
    }
  }

  if (Array.isArray(d.topPriority)) {
    for (const p of d.topPriority) {
      const id = p?.community?.id
      if (typeof id === 'string') {
        out.push({ path: `packages/systems/${id}`, isDir: true })
      }
    }
  }

  return out
    .map(x => ({ ...x, path: stripAbsRepoPrefix(x.path) }))
    .filter(x => isLikelyRepoPath(x.path))
}

// Walk every report → (metricId, path, isDir, fromFailing). De-dup (metricId, path).
function collectFlags(reports) {
  const seen = new Set()
  const flags = []
  for (const r of reports) {
    const paths = extractFlagPaths(r)
    for (const { path, isDir } of paths) {
      const key = `${r.metricId}|${path}`
      if (seen.has(key)) continue
      seen.add(key)
      flags.push({
        metricId: r.metricId,
        metricName: r.metricName,
        path,
        isDir,
        fromFailing: !r.passed,
      })
    }
  }
  return flags
}

// ── Tree assembly ─────────────────────────────────────────────────────────────

// Tree node: { name, fullPath, type: 'dir'|'file', children: Map<string, Node>,
//   flags: Flag[], flaggedDescendants: number, hotDescendants: number, severity }

function newNode(name, fullPath, type) {
  return { name, fullPath, type, children: new Map(), flags: [] }
}

function ensurePath(root, segments, isDir) {
  let node = root
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]
    const last = i === segments.length - 1
    const type = last ? (isDir ? 'dir' : 'file') : 'dir'
    const fullPath = segments.slice(0, i + 1).join('/')
    let child = node.children.get(name)
    if (!child) {
      child = newNode(name, fullPath, type)
      node.children.set(name, child)
    } else if (last && isDir && child.type === 'file') {
      // path collision — prefer dir over file
      child.type = 'dir'
    }
    node = child
  }
  return node
}

function buildTree(flags) {
  const root = newNode('', '', 'dir')
  for (const flag of flags) {
    const segs = flag.path.split('/').filter(Boolean)
    if (segs.length === 0) continue
    const node = ensurePath(root, segs, flag.isDir)
    node.flags.push(flag)
  }
  return root
}

function fileSeverity(flagCount) {
  if (flagCount >= HEAT_RED) return 'red'
  if (flagCount >= HEAT_ORANGE) return 'orange'
  if (flagCount >= HEAT_YELLOW) return 'yellow'
  return 'green'
}

function worstSeverity(a, b) {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b
}

// Per-flag debt weighting. Failing-metric flags count more because they're
// actually over budget; passing-metric "hot list" flags are softer signal.
const FLAG_WEIGHT_FAILING = 3
const FLAG_WEIGHT_PASSING = 1

function flagsDebt(flags) {
  let d = 0
  for (const f of flags) d += f.fromFailing ? FLAG_WEIGHT_FAILING : FLAG_WEIGHT_PASSING
  // Compounding bonus: a file flagged by N distinct metrics is worse than N independent
  // files flagged once — concerns intersect. Add (N-1) bonus points beyond N=1.
  const distinctMetrics = new Set(flags.map(f => f.metricId)).size
  if (distinctMetrics > 1) d += (distinctMetrics - 1)
  return d
}

// Annotate every node with severity + descendant counts + debt score. Bottom-up.
function annotate(node) {
  let flaggedDescendants = node.type === 'file' && node.flags.length > 0 ? 1 : 0
  let hotDescendants = 0
  let severity = 'green'
  let totalFlags = node.flags.length
  let debt = flagsDebt(node.flags)

  if (node.type === 'file') {
    severity = fileSeverity(node.flags.length)
    if (severity === 'orange' || severity === 'red') hotDescendants = 1
  } else if (node.flags.length > 0) {
    // dir: also count own flags (e.g. directory-level violations) — treat as a "self-flag"
    const selfSev = fileSeverity(node.flags.length)
    severity = worstSeverity(severity, selfSev)
    flaggedDescendants += 1 // count the directory itself once
    if (selfSev === 'orange' || selfSev === 'red') hotDescendants += 1
  }

  for (const child of node.children.values()) {
    annotate(child)
    flaggedDescendants += child.flaggedDescendants
    hotDescendants += child.hotDescendants
    totalFlags += child.totalFlags
    debt += child.debt
    severity = worstSeverity(severity, child.severity)
  }

  node.flaggedDescendants = flaggedDescendants
  node.hotDescendants = hotDescendants
  node.totalFlags = totalFlags
  node.severity = severity
  node.debt = debt
}

// Prune any subtree with zero flagged descendants — keeps the visible tree
// focused on what actually has signal.
function pruneClean(node) {
  for (const [name, child] of [...node.children]) {
    pruneClean(child)
    if (child.flaggedDescendants === 0 && child.flags.length === 0 && child.children.size === 0) {
      node.children.delete(name)
    }
  }
}

// Collapse single-child directory chains for compactness:
// `packages/systems/agent-runtime/src/spawn` becomes one node when each
// intermediate dir has exactly one dir child and no own flags.
function collapseChains(node) {
  for (const child of node.children.values()) collapseChains(child)

  if (node.type !== 'dir' || node.flags.length > 0) return
  if (node.children.size !== 1) return
  const [only] = node.children.values()
  if (only.type !== 'dir') return
  if (node.name === '') return // never collapse the synthetic root

  node.name = `${node.name}/${only.name}`
  node.fullPath = only.fullPath
  node.flags = only.flags
  node.children = only.children
  // severity / counts unchanged (only had one child)
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function severityLabel(sev) {
  if (sev === 'red')    return 'hot'
  if (sev === 'orange') return 'warm'
  if (sev === 'yellow') return 'touched'
  return 'clean'
}

function flagSummaryTitle(flags) {
  if (flags.length === 0) return ''
  const byMetric = new Map()
  for (const f of flags) {
    const cur = byMetric.get(f.metricId) ?? { name: f.metricName, failing: false }
    cur.failing = cur.failing || f.fromFailing
    byMetric.set(f.metricId, cur)
  }
  return [...byMetric.entries()]
    .map(([, { name, failing }]) => `${failing ? '✗' : '•'} ${name}`)
    .join('\n')
}

function renderFlagChips(flags) {
  if (flags.length === 0) return ''
  const byMetric = new Map()
  for (const f of flags) {
    const cur = byMetric.get(f.metricId) ?? { name: f.metricName, failing: false }
    cur.failing = cur.failing || f.fromFailing
    byMetric.set(f.metricId, cur)
  }
  return `<span class="ft-chips">${
    [...byMetric.entries()]
      .map(([id, { name, failing }]) =>
        `<span class="ft-chip ${failing ? 'is-fail' : 'is-touch'}" title="${esc(name)}${failing ? ' (failing)' : ''}">${esc(id)}</span>`)
      .join('')
  }</span>`
}

function renderFile(node) {
  const sev = node.severity
  const debt = node.debt ?? 0
  return `<li class="ft-file ft-sev-${sev}" title="${esc(flagSummaryTitle(node.flags))}">
    <span class="ft-row">
      <span class="ft-dot" aria-hidden="true"></span>
      <span class="ft-name">${esc(node.name)}</span>
      <span class="ft-count" title="${node.flags.length} flag${node.flags.length === 1 ? '' : 's'}">${node.flags.length}</span>
      <span class="ft-debt" title="Debt: ${debt} points">${debt}</span>
      ${renderFlagChips(node.flags)}
    </span>
  </li>`
}

function dirSummary(node) {
  const sev = node.severity
  const files = node.flaggedDescendants
  const hot = node.hotDescendants
  const detail = sev === 'green'
    ? 'clean'
    : `${files} flagged${hot > 0 ? ` · ${hot} hot` : ''}`
  const ownFlags = node.flags.length > 0 ? renderFlagChips(node.flags) : ''
  const debt = node.debt ?? 0
  const debtBadge = debt > 0
    ? `<span class="ft-debt" title="Containing debt: ${debt} points\n  failing flag = ${FLAG_WEIGHT_FAILING}pts, passing-hot flag = ${FLAG_WEIGHT_PASSING}pt, +1 per extra distinct metric per file">${debt}</span>`
    : ''
  return `<summary class="ft-row">
    <span class="ft-dot" aria-hidden="true"></span>
    <span class="ft-name">${esc(node.name || '/')}<span class="ft-slash">/</span></span>
    <span class="ft-detail">${esc(detail)}</span>
    ${debtBadge}
    ${ownFlags}
  </summary>`
}

function compareChildren(a, b) {
  // Highest debt first; tie-break by severity, then dirs before files, then name.
  const debtDiff = (b.debt ?? 0) - (a.debt ?? 0)
  if (debtDiff !== 0) return debtDiff
  const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  if (sevDiff !== 0) return sevDiff
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}

function renderNode(node, openSet, isRoot = false) {
  if (node.type === 'file') return renderFile(node)
  const sev = node.severity
  const open = openSet.has(node.fullPath)
  const childArr = [...node.children.values()].sort(compareChildren)
  const childHtml = childArr.map(c => renderNode(c, openSet, false)).join('')
  const details = `<details class="ft-dir ft-sev-${sev}" ${open ? 'open' : ''}>
    ${dirSummary(node)}
    <ul class="ft-children">${childHtml}</ul>
  </details>`
  return isRoot ? details : `<li class="ft-dir-item">${details}</li>`
}

// Pick which dirs to auto-open under a "max N visible nodes" budget. Top-level
// dirs (children of the synthetic root) are always visible — they seed the
// count. Then greedily open the highest-debt candidate whose direct children
// still fit in the remaining budget. Opening a dir surfaces every (post-prune)
// child as a new visible node, and its child dirs become future candidates.
// Stops when no remaining visible-but-collapsed dir fits.
function pickAutoOpenDirs(root, budget) {
  const opened = new Set()
  let visibleCount = root.children.size
  const candidates = []
  for (const c of root.children.values()) {
    if (c.type === 'dir' && (c.debt ?? 0) > 0) candidates.push(c)
  }
  while (true) {
    candidates.sort((a, b) => (b.debt ?? 0) - (a.debt ?? 0))
    let chosenIdx = -1
    for (let i = 0; i < candidates.length; i++) {
      if (visibleCount + candidates[i].children.size <= budget) { chosenIdx = i; break }
    }
    if (chosenIdx < 0) break
    const chosen = candidates.splice(chosenIdx, 1)[0]
    opened.add(chosen.fullPath)
    visibleCount += chosen.children.size
    for (const gc of chosen.children.values()) {
      if (gc.type === 'dir' && (gc.debt ?? 0) > 0) candidates.push(gc)
    }
  }
  return opened
}

// ── Public ────────────────────────────────────────────────────────────────────

export function renderFileTreeSection(reports) {
  const flags = collectFlags(reports ?? [])
  if (flags.length === 0) {
    return `<section class="filetree-section">
      <div class="category-header">
        <span class="category-name">Unhealthy Folders</span>
        <span class="category-rule"></span>
        <span class="category-tally">no per-file violations recorded</span>
      </div>
      <p class="ft-empty">No reports surfaced file or folder paths in their <code>details</code>.</p>
    </section>`
  }

  const tree = buildTree(flags)
  annotate(tree)
  pruneClean(tree)
  for (const child of tree.children.values()) collapseChains(child)
  annotate(tree) // re-annotate after chain collapse (paths changed)

  const totalFlagged = tree.flaggedDescendants
  const totalHot = tree.hotDescendants
  const totalDebt = tree.debt
  const metricsCount = new Set(flags.map(f => f.metricId)).size

  const openSet = pickAutoOpenDirs(tree, MAX_VISIBLE_NODES)
  const roots = [...tree.children.values()].sort(compareChildren)
  const body = roots.map(r => renderNode(r, openSet, true)).join('')

  return `<section class="filetree-section">
    <div class="category-header">
      <span class="category-name">Unhealthy Folders</span>
      <span class="category-rule"></span>
      <span class="category-tally">debt ${totalDebt} · ${totalFlagged} flagged · ${totalHot} hot · ${metricsCount} metrics</span>
    </div>
    <p class="ft-help">
      <strong>Containing debt</strong> rolls up per file (failing flag = ${FLAG_WEIGHT_FAILING}pts, passing-hot flag = ${FLAG_WEIGHT_PASSING}pt, +1 bonus per extra distinct metric) and aggregates into folders.
      Children sort worst-debt first. Auto-expansion is budgeted to ${MAX_VISIBLE_NODES} visible rows total — opening a folder spends budget on every revealed file and subfolder.
    </p>
    <div class="ft-legend">
      <span class="ft-legend-item ft-sev-red"><span class="ft-dot"></span>hot · ${HEAT_RED}+ flags</span>
      <span class="ft-legend-item ft-sev-orange"><span class="ft-dot"></span>warm · ${HEAT_ORANGE}–${HEAT_RED - 1} flags</span>
      <span class="ft-legend-item ft-sev-yellow"><span class="ft-dot"></span>touched · 1 flag</span>
    </div>
    <div class="ft-tree">${body}</div>
  </section>`
}
