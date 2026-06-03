// Browser-only stub of `@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD`.
//
// The real module renders inline image previews via hostAPI.main.readImageAsDataUrl
// and pulls in the spatial-index + anchor-to-node chain. The playground keeps
// image viewers stubbed (per playground scope) — hovering an image node is a
// no-op rather than a viewer popup.

import type { Core } from 'cytoscape'

export async function createFloatingImageViewer(): Promise<undefined> {
    return undefined
}

export function closeImageViewer(_cy: Core, _viewer: unknown): void {}

export function closeHoverImageViewer(_cy: Core): void {}

export async function openHoverImageViewer(): Promise<undefined> {
    return undefined
}

export async function createAnchoredFloatingImageViewer(): Promise<undefined> {
    return undefined
}
