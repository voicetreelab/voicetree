import type { CyDump, CyDumpNode } from '../debug/state/cyStateShape'

export interface FolderAspectViolation {
  readonly folderId: string
  readonly label: string
  readonly childCount: number
  readonly bboxWidth: number
  readonly bboxHeight: number
  readonly aspectRatio: number
  readonly thresholdExceeded: number
}

export interface FolderAspectReport {
  readonly threshold: number
  readonly foldersChecked: number
  readonly violations: readonly FolderAspectViolation[]
  readonly worstViolation: FolderAspectViolation | null
}

type Bounds = {
  left: number
  right: number
  top: number
  bottom: number
}

function isExpandedFolder(node: CyDumpNode): boolean {
  return node.data?.isFolderNode === true && node.data?.collapsed !== true
}

function hasFinitePosition(node: CyDumpNode): boolean {
  return Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y)
}

function boundsForNode(node: CyDumpNode): Bounds | null {
  if (!hasFinitePosition(node)) return null

  const halfWidth = Number.isFinite(node.width) ? Math.max(0, (node.width ?? 0) / 2) : 0
  const halfHeight = Number.isFinite(node.height) ? Math.max(0, (node.height ?? 0) / 2) : 0

  return {
    left: node.position.x - halfWidth,
    right: node.position.x + halfWidth,
    top: node.position.y - halfHeight,
    bottom: node.position.y + halfHeight,
  }
}

function computeChildBounds(children: readonly CyDumpNode[]): Bounds | null {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const child of children) {
    const bounds = boundsForNode(child)
    if (!bounds) return null
    left = Math.min(left, bounds.left)
    right = Math.max(right, bounds.right)
    top = Math.min(top, bounds.top)
    bottom = Math.max(bottom, bounds.bottom)
  }

  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null
  }

  return { left, right, top, bottom }
}

function folderLabel(node: CyDumpNode): string {
  return node.data?.folderLabel ?? node.data?.label ?? node.id
}

export function computeFolderAspects(
  dump: CyDump,
  opts: { threshold?: number; minChildCount?: number } = {},
): FolderAspectReport {
  const threshold = opts.threshold ?? 3
  const minChildCount = opts.minChildCount ?? 3
  let foldersChecked = 0
  const violations: FolderAspectViolation[] = []

  for (const folder of dump.nodes.filter(isExpandedFolder)) {
    const children = dump.nodes.filter(node => node.data?.parent === folder.id)
    if (children.length < minChildCount) continue

    const bounds = computeChildBounds(children)
    if (!bounds) continue

    foldersChecked += 1
    const bboxWidth = bounds.right - bounds.left
    const bboxHeight = bounds.bottom - bounds.top
    const aspectRatio = Math.max(bboxWidth, bboxHeight) / Math.max(1, Math.min(bboxWidth, bboxHeight))

    if (aspectRatio > threshold) {
      violations.push({
        folderId: folder.id,
        label: folderLabel(folder),
        childCount: children.length,
        bboxWidth,
        bboxHeight,
        aspectRatio,
        thresholdExceeded: aspectRatio,
      })
    }
  }

  violations.sort((left, right) => {
    if (right.aspectRatio !== left.aspectRatio) return right.aspectRatio - left.aspectRatio
    return left.folderId.localeCompare(right.folderId)
  })

  return {
    threshold,
    foldersChecked,
    violations,
    worstViolation: violations[0] ?? null,
  }
}
