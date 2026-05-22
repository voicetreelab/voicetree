export const STALE_MS = 7 * 24 * 60 * 60 * 1000

export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export function fmtNum(n) {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1000) return n.toFixed(0)
  if (abs >= 100)  return n.toFixed(1)
  if (abs >= 10)   return n.toFixed(2)
  if (abs >= 1)    return n.toFixed(3)
  return n.toFixed(4)
}

export function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0)       return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60)       return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)       return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)       return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function isStale(iso) {
  return Date.now() - new Date(iso).getTime() > STALE_MS
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000)   return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m${s.toString().padStart(2, '0')}s`
}
