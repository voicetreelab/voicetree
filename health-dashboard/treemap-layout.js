// Pure: squarified treemap layout. Items are { node, weight } pre-sorted desc
// by weight. Returns array of { node, rect } placements where rect = {x,y,w,h}.
// Algorithm: accumulate row while worst-aspect improves; commit & recurse on
// the leftover rectangle when the next item would make worst-aspect worse.

// Given a candidate row of cell areas, the row's total area, and the rect we
// are filling, compute the worst aspect ratio (longSide/shortSide ≥ 1) if the
// row were committed now. The committed row occupies one strip along the
// rect's long edge; its depth is rowSum / longSide.
function worstAspect (rowAreas, rowSum, rect) {
  if (rowAreas.length === 0) return Infinity
  const longSide = Math.max(rect.w, rect.h)
  const stripDepth = rowSum / longSide
  let worst = 0
  for (const a of rowAreas) {
    const cellLen = a / stripDepth
    const r = Math.max(cellLen / stripDepth, stripDepth / cellLen)
    if (r > worst) worst = r
  }
  return worst
}

// Commit a row to one strip of `rect` along its short side. Push placements
// into `out`. Returns the leftover rect (the remainder along the long edge).
function placeRow (rowItems, rowAreas, rowSum, rect, out) {
  const horizontalStrip = rect.w >= rect.h
  if (horizontalStrip) {
    const stripH = rowSum / rect.w
    let x = rect.x
    for (let i = 0; i < rowItems.length; i++) {
      const cellW = rowAreas[i] / stripH
      out.push({ node: rowItems[i], rect: { x, y: rect.y, w: cellW, h: stripH } })
      x += cellW
    }
    return { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH }
  }
  const stripW = rowSum / rect.h
  let y = rect.y
  for (let i = 0; i < rowItems.length; i++) {
    const cellH = rowAreas[i] / stripW
    out.push({ node: rowItems[i], rect: { x: rect.x, y, w: stripW, h: cellH } })
    y += cellH
  }
  return { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h }
}

export function squarify (items, rect) {
  const totalWeight = items.reduce((s, it) => s + it.weight, 0)
  if (totalWeight <= 0 || rect.w <= 0 || rect.h <= 0) return []
  const totalArea = rect.w * rect.h
  const work = items.map((it) => ({ node: it.node, area: (it.weight / totalWeight) * totalArea }))

  const out = []
  let cur = { ...rect }
  let row = []
  let rowAreas = []
  let rowSum = 0
  let i = 0

  while (i < work.length) {
    const next = work[i]
    const tentativeAreas = [...rowAreas, next.area]
    const tentativeSum = rowSum + next.area
    const wPrev = worstAspect(rowAreas, rowSum, cur)
    const wNext = worstAspect(tentativeAreas, tentativeSum, cur)

    if (row.length === 0 || wNext <= wPrev) {
      row.push(next.node)
      rowAreas = tentativeAreas
      rowSum = tentativeSum
      i++
    } else {
      // commit current row; do NOT consume `next` — it seeds the next row.
      cur = placeRow(row, rowAreas, rowSum, cur, out)
      row = []
      rowAreas = []
      rowSum = 0
    }
  }
  if (row.length > 0) placeRow(row, rowAreas, rowSum, cur, out)
  return out
}
