// Browser-mode clipboard image I/O against VTD.
//
// Electron does this natively: the renderer reads the OS clipboard and writes a
// sibling image file directly. The browser can't touch the filesystem, so the
// flow splits across the gateway:
//   - `readClipboardImageBlob` pulls the pasted image off the OS clipboard via
//     the async Clipboard API (the only impure, browser-only step).
//   - `uploadClipboardImage` POSTs those bytes to VTD, which writes the file and
//     returns the `pasted-….png` filename — the SAME contract Electron returns,
//     so the editor's `![[…]]` insertion is unchanged.
//   - `vtdReadImageAsDataUrl` fetches an image's bytes back from VTD and builds
//     a data URL, matching Electron's readImageAsDataUrl return shape.

function authHeaders(token: string): Record<string, string> {
    return {Authorization: `Bearer ${token}`}
}

/**
 * Encode raw bytes as a `data:<mime>;base64,…` URL. Chunked btoa so a multi-MB
 * image doesn't blow the argument limit of String.fromCharCode. Pure.
 */
export function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return `data:${contentType};base64,${btoa(binary)}`
}

/**
 * Read the first image on the OS clipboard as a Blob, or null when the clipboard
 * holds no image (or the Clipboard API is unavailable). The only browser-only,
 * impure step — kept separate so the upload path stays testable.
 */
export async function readClipboardImageBlob(): Promise<Blob | null> {
    if (!navigator.clipboard?.read) return null
    const items = await navigator.clipboard.read()
    for (const item of items) {
        const imageType = item.types.find((t: string) => t.startsWith('image/'))
        if (imageType !== undefined) return item.getType(imageType)
    }
    return null
}

/**
 * Upload pasted image bytes to VTD, which writes them as a sibling of the given
 * markdown node and returns the relative filename (e.g. "pasted-….png").
 */
export async function uploadClipboardImage(
    vtdUrl: string,
    token: string,
    markdownNodeId: string,
    image: Blob,
): Promise<string> {
    // Send the bytes explicitly (ArrayBuffer) rather than the Blob: the MIME is
    // carried by our Content-Type header, so there's no reason to depend on the
    // runtime's Blob-body serialization.
    const bytes = await image.arrayBuffer()
    const res = await fetch(
        `${vtdUrl}/clipboard-image?nodeId=${encodeURIComponent(markdownNodeId)}`,
        {
            method: 'POST',
            headers: {...authHeaders(token), 'Content-Type': image.type || 'image/png'},
            body: bytes,
        },
    )
    if (res.status === 401) throw new Error('VTD auth failed (401)')
    if (!res.ok) throw new Error(`VTD /clipboard-image → ${res.status}`)
    const body = await res.json() as {filename: string}
    return body.filename
}

/**
 * Fetch an image's bytes from VTD and return them as a data URL, or null when
 * the file is absent (VTD answers 404). Mirrors Electron's readImageAsDataUrl.
 */
export async function vtdReadImageAsDataUrl(
    vtdUrl: string,
    token: string,
    imagePath: string,
): Promise<string | null> {
    const res = await fetch(
        `${vtdUrl}/image?path=${encodeURIComponent(imagePath)}`,
        {headers: authHeaders(token)},
    )
    if (res.status === 404) return null
    if (res.status === 401) throw new Error('VTD auth failed (401)')
    if (!res.ok) throw new Error(`VTD /image → ${res.status}`)
    const contentType = res.headers.get('Content-Type') ?? 'image/png'
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytesToDataUrl(bytes, contentType)
}
