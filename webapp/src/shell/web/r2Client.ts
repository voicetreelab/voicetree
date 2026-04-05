import type { ShareId, RelativePath, ShareManifest } from '@vt/graph-model/pure/web-share/types'
import type { Position } from '@vt/graph-model/pure/graph'

export async function fetchManifest(baseUrl: string, id: ShareId): Promise<ShareManifest> {
    const res: Response = await fetch(`${baseUrl}/share/${id}/manifest.json`)
    if (!res.ok) throw new Error(`fetchManifest failed: ${res.status} ${res.statusText}`)
    return res.json() as Promise<ShareManifest>
}

export async function fetchFiles(
    baseUrl: string,
    id: ShareId,
    paths: readonly RelativePath[]
): Promise<ReadonlyMap<RelativePath, string>> {
    const entries: [RelativePath, string][] = await Promise.all(
        paths.map(async (p: RelativePath): Promise<[RelativePath, string]> => {
            const res: Response = await fetch(`${baseUrl}/share/${id}/${p}`)
            if (!res.ok) throw new Error(`fetchFiles failed for ${p}: ${res.status} ${res.statusText}`)
            const text: string = await res.text()
            return [p, text]
        })
    )
    return new Map(entries)
}

export async function fetchPositions(
    baseUrl: string,
    id: ShareId
): Promise<ReadonlyMap<string, Position>> {
    const res: Response = await fetch(`${baseUrl}/share/${id}/.voicetree/positions.json`)
    if (res.status === 404) return new Map()
    if (!res.ok) throw new Error(`fetchPositions failed: ${res.status} ${res.statusText}`)
    const parsed: Record<string, Position> = await res.json() as Record<string, Position>
    return new Map(Object.entries(parsed))
}

export async function uploadToR2(
    baseUrl: string,
    files: ReadonlyMap<RelativePath, string>,
    manifest: ShareManifest
): Promise<ShareId> {
    const form: FormData = new FormData()
    form.append('folderName', manifest.folderName)
    for (const [filePath, content] of files) {
        form.append('files', new Blob([content], { type: 'text/markdown' }), filePath)
    }
    const res: Response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`uploadToR2 failed: ${res.status} ${res.statusText}`)
    const body: { shareId: ShareId } = await res.json() as { shareId: ShareId }
    return body.shareId
}
