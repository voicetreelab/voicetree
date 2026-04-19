export type ScreenshotSample = {
  bytes: number
}

export type BlankConsoleMessage = {
  level: string
  text: string
  atIso?: string
}

export type BlankException = {
  message: string
  stack?: string
  atIso?: string
}

export type BlankMessages = {
  console: BlankConsoleMessage[]
  exceptions: BlankException[]
}

export type BlankState = {
  loadedRoots: string[]
  graphNodeCount: number
  projectedNodeCount: number
}

export type RootDomInfo = {
  exists: boolean
  clientWidth: number
  clientHeight: number
  rectWidth: number
  rectHeight: number
  childElementCount: number
  display: string
  visibility: string
}

function summarize(text: string, maxLen: number = 120): string {
  const flattened = text.replace(/\s+/g, ' ').trim()
  if (flattened.length <= maxLen) return flattened
  return `${flattened.slice(0, maxLen - 1)}…`
}

/**
 * Prefixes:
 * - Blank because:
 * - React never mounted
 * - no roots loaded
 * - Root hidden by CSS:
 * - Projection is empty:
 */
export function diagnose(
  shot: ScreenshotSample,
  msgs: BlankMessages,
  state: BlankState,
  root: RootDomInfo,
): string {
  const latestException = msgs.exceptions.at(-1)
  if (latestException) {
    return `Blank because: uncaught startup exception detected (${summarize(latestException.message)}).`
  }

  if (root.exists && (root.display === 'none' || root.visibility === 'hidden' || root.visibility === 'collapse')) {
    return `Root hidden by CSS: #root is ${root.display === 'none' ? 'display:none' : `visibility:${root.visibility}`}.`
  }

  if (!root.exists) {
    return 'React never mounted because #root is missing.'
  }

  if (root.clientHeight <= 0 || root.rectHeight <= 0) {
    return `React never mounted because #root has zero height (${root.clientHeight}px client, ${root.rectHeight}px rect).`
  }

  if (state.loadedRoots.length === 0) {
    return 'no roots loaded in live state, so there is nothing to render.'
  }

  if (state.graphNodeCount > 0 && state.projectedNodeCount === 0) {
    return `Projection is empty: state has ${state.graphNodeCount} graph nodes but projected 0 visible elements.`
  }

  const lastConsole = msgs.console.at(-1)?.text
  const consoleSuffix = lastConsole ? ` Last console message: ${summarize(lastConsole)}.` : ''
  return `Inconclusive: screenshot bytes=${shot.bytes}, loadedRoots=${state.loadedRoots.length}, projected=${state.projectedNodeCount}.${consoleSuffix}`
}
