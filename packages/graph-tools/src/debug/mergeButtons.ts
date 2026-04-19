export type BBox = {
  x: number
  y: number
  w: number
  h: number
}

export type ButtonCandidate = {
  label: string
  selector: string
  bbox: BBox
  enabled: boolean
}

export type RegistryButtonCandidate = ButtonCandidate & {
  nodeId: string
}

export type ButtonInfo = ButtonCandidate & {
  source: 'ax' | 'registry'
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}

export function mergeButtons(
  ax: readonly ButtonCandidate[],
  registry: readonly RegistryButtonCandidate[],
  nodeId: string,
): readonly ButtonInfo[] {
  const merged: ButtonInfo[] = []
  const seenSelectors = new Set<string>()

  for (const button of ax) {
    if (!isNonEmpty(button.selector) || seenSelectors.has(button.selector)) continue
    seenSelectors.add(button.selector)
    merged.push({ ...button, source: 'ax' })
  }

  for (const button of registry) {
    if (button.nodeId !== nodeId) continue
    if (!isNonEmpty(button.selector) || seenSelectors.has(button.selector)) continue
    seenSelectors.add(button.selector)
    merged.push({
      label: button.label,
      selector: button.selector,
      bbox: button.bbox,
      enabled: button.enabled,
      source: 'registry',
    })
  }

  return merged
}
