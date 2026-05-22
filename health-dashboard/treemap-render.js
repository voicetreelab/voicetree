import { esc, fmtNum } from './format.js'
import { collectLeaves, utilCapped } from './treemap-hierarchy.js'
import { squarify } from './treemap-layout.js'

// ── Colour ramp ─────────────────────────────────────────────────────────────
// Status maps to a hex pair; t = 0.45 + 0.55 * (utilCapped/2). Dimmer at low
// utilization, brighter near 1×. Gate-pass is a flat token colour.

const hexToRgb = (h) => {
  const m = h.replace('#','')
  return [parseInt(m.slice(0,2),16), parseInt(m.slice(2,4),16), parseInt(m.slice(4,6),16)]
}
const rgbToHex = (r,g,b) => {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2,'0')
  return `#${c(r)}${c(g)}${c(b)}`
}
const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b)
  return rgbToHex(lerp(A[0],B[0],t), lerp(A[1],B[1],t), lerp(A[2],B[2],t))
}

const RAMP = {
  fail:    ['#5e1a14', '#ff4438'],
  caution: ['#5a3f12', '#f5b04a'],
  pass:    ['#2c4416', '#9ce363'],
}
const GATE_PASS = '#4d4430'

function leafColour (leaf) {
  if (leaf.status === 'gate-pass') return GATE_PASS
  const ramp = RAMP[leaf.status] ?? RAMP.pass
  const t = 0.45 + 0.55 * (leaf.utilCapped / 2)
  return mix(ramp[0], ramp[1], t)
}

// ── Weight ──────────────────────────────────────────────────────────────────
// In count mode every leaf is 1; in util mode leaves are floored at 0.18 so a
// passing-at-budget metric still gets a visible cell. Parents weight = sum of
// descendant leaf weights so their allocated area exactly equals their leaves'.

const leafWeight = (leaf, mode) => mode === 'count' ? 1 : Math.max(leaf.utilCapped, 0.18)
const nodeWeight = (node, mode) =>
  node.kind === 'leaf'
    ? leafWeight(node, mode)
    : collectLeaves(node).reduce((s, l) => s + leafWeight(l, mode), 0)

// ── Padding ─────────────────────────────────────────────────────────────────

const CAT_PAD_TOP = 22, CAT_PAD_SIDE = 2
const SUB_PAD_TOP = 13, SUB_PAD_SIDE = 1
const SUB_MIN_W   = 60, SUB_MIN_H    = 20

const shrink = (rect, padTop, padSide) => ({
  x: rect.x + padSide,
  y: rect.y + padTop,
  w: Math.max(0, rect.w - 2 * padSide),
  h: Math.max(0, rect.h - padTop - padSide),
})

const fmtUtil = (u) => Number.isFinite(u) ? `${u.toFixed(2)}×` : '∞×'

// Strip category prefixes so leaves read compact when there's only ~60-100px
// of width. E.g. "Globals · console" inside the Globals subgroup → "console".
const stripPrefix = (n) => n
  .replace(/^Globals · /, '')
  .replace(/^Hypergraph /, '')
  .replace(/^Boundary /, '')
  .replace(/^Cross-package /, '')
  .replace(/^Codebase · /, '')
  .replace(/^DSM · /, '')
  .replace(/^AST · /, '')
  .replace(/^Ratio · /, '')
  .replace(/^Shape · /, '')
  .replace(/^Exports per file · /, 'Exports · ')

// ── Per-node SVG render ────────────────────────────────────────────────────

function leafLabel (rect, name, uTxt) {
  if (rect.w < 60 || rect.h < 22) {
    if (rect.w < 36 || rect.h < 14) return ''
    return `<text class="tm-leaf-meta" x="${rect.x + 3}" y="${rect.y + 10}">${esc(uTxt)}</text>`
  }
  const maxChars = Math.max(4, Math.floor((rect.w - 10) / 6.4))
  const short = stripPrefix(name)
  const txt = short.length > maxChars ? short.slice(0, Math.max(1, maxChars - 1)) + '…' : short
  const utilLine = rect.h >= 32 ? `<text class="tm-leaf-meta" x="${rect.x + 5}" y="${rect.y + 25}">${esc(uTxt)}</text>` : ''
  return `<text class="tm-leaf-label" x="${rect.x + 5}" y="${rect.y + 13}">${esc(txt)}</text>${utilLine}`
}

function renderLeafRect (leaf, rect) {
  if (rect.w <= 0 || rect.h <= 0) return ''
  const r = leaf.report
  const uTxt = fmtUtil(leaf.util)
  const cmpSym = r.comparison === 'lte' ? '≤' : '≥'
  const unit = r.unit ? ` ${r.unit}` : ''
  const tooltip = `${leaf.name} — ${leaf.status.toUpperCase()} · ${uTxt}\ncurrent ${fmtNum(r.current)} / budget ${cmpSym} ${fmtNum(r.budget)}${unit}\nid: ${r.metricId}`
  const attrs = `data-kind="leaf" data-id="${esc(r.metricId)}" data-name="${esc(leaf.name)}" data-current="${fmtNum(r.current)}" data-budget="${fmtNum(r.budget)}" data-unit="${esc(r.unit ?? '')}" data-cmp="${esc(r.comparison)}" data-util="${esc(uTxt)}" data-status="${esc(leaf.status)}"`
  const gateCls = leaf.status === 'gate-pass' ? ' is-gate' : ''
  return `<g class="tm-leaf tm-status-${esc(leaf.status)}${gateCls}" ${attrs}>
    <rect class="tm-leaf-rect" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${leafColour(leaf)}"><title>${esc(tooltip)}</title></rect>
    ${leafLabel(rect, leaf.name, uTxt)}
  </g>`
}

function renderPlacements (placements, mode) {
  let out = ''
  for (const { node, rect } of placements) {
    if (node.kind === 'leaf')          out += renderLeafRect(node, rect)
    else if (node.kind === 'subgroup') out += renderSubgroupRect(node, rect, mode)
    else                                out += renderCategoryRect(node, rect, mode)
  }
  return out
}

function layoutChildren (node, rect, mode) {
  const items = node.children
    .map((c) => ({ node: c, weight: nodeWeight(c, mode) }))
    .filter((it) => it.weight > 0)
    .sort((a, b) => b.weight - a.weight)
  return squarify(items, rect)
}

function renderSubgroupRect (sub, rect, mode) {
  if (rect.w <= 0 || rect.h <= 0) return ''
  const labelFits = rect.w >= SUB_MIN_W && rect.h >= SUB_MIN_H
  const inner = labelFits ? shrink(rect, SUB_PAD_TOP, SUB_PAD_SIDE) : rect
  const failCls = sub.passed ? '' : 'is-fail'
  const header = labelFits
    ? `<text class="tm-sub-label" x="${rect.x + 4}" y="${rect.y + 10}">${esc(sub.name)}</text>` +
      (rect.w >= 130 ? `<text class="tm-sub-meta" x="${rect.x + rect.w - 4}" y="${rect.y + 10}" text-anchor="end">${esc(fmtUtil(sub.util))}</text>` : '')
    : ''
  return `<g class="tm-subgroup">
    ${renderPlacements(layoutChildren(sub, inner, mode), mode)}
    <rect class="tm-sub-frame ${failCls}" x="${rect.x + 0.5}" y="${rect.y + 0.5}" width="${rect.w - 1}" height="${rect.h - 1}"></rect>
    ${header}
  </g>`
}

function renderCategoryRect (cat, rect, mode) {
  if (rect.w <= 0 || rect.h <= 0) return ''
  const failCls = cat.passed ? '' : 'is-fail'
  const leafCount = collectLeaves(cat).length
  const labelFits = rect.w > 100 && rect.h > 24
  // Degenerate slivers: skip label padding entirely, place children flush.
  // Without this, a category < 22px tall would never render its leaves.
  const inner = labelFits ? shrink(rect, CAT_PAD_TOP, CAT_PAD_SIDE) : rect
  const meta = `${fmtUtil(cat.util)} · n=${leafCount}`
  const fontSize = Math.min(rect.w * 0.06, 18)
  return `<g class="tm-category ${failCls}">
    <rect class="tm-cat-bg" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}"></rect>
    ${renderPlacements(layoutChildren(cat, inner, mode), mode)}
    <rect class="tm-cat-frame ${failCls}" x="${rect.x + 0.5}" y="${rect.y + 0.5}" width="${rect.w - 1}" height="${rect.h - 1}"></rect>
    ${labelFits ? `<text class="tm-cat-label" x="${rect.x + 8}" y="${rect.y + 16}" style="font-size:${fontSize}px">${esc(cat.name)}</text>` : ''}
    ${labelFits ? `<text class="tm-cat-meta"  x="${rect.x + rect.w - 8}" y="${rect.y + 14}" text-anchor="end">${esc(meta)}</text>` : ''}
  </g>`
}

// ── Public ──────────────────────────────────────────────────────────────────

const WIDTH = 1200
const HEIGHT = 620

export function renderTreemapSvg (categories, mode) {
  const items = categories
    .map((c) => ({ node: c, weight: nodeWeight(c, mode) }))
    .filter((it) => it.weight > 0)
    .sort((a, b) => b.weight - a.weight)
  const placements = squarify(items, { x: 0, y: 0, w: WIDTH, h: HEIGHT })
  return `<svg class="tm-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="Hierarchy treemap of ${categories.length} categories">
    ${renderPlacements(placements, mode)}
  </svg>`
}
