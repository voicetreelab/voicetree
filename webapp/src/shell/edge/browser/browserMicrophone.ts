// Browser-native microphone permission edge.
//
// The Electron host answers these via `systemPreferences` (a native macOS
// permission API). A browser has an entirely different model: permission is
// granted through `getUserMedia` and observable through the Permissions API.
// This module maps the browser primitives onto the same `MicrophonePermissionStatus`
// contract the transcribe view consumes, so voice capture works in browser mode
// instead of being permanently blocked.
//
// Both functions are thin adapters over `navigator.*`; the impurity stays here
// at the edge and the status mapping is a pure switch.

/** Mirrors the Electron `MicrophonePermissionStatus` the renderer expects. */
export type MicrophonePermissionStatus =
    | 'not-determined'
    | 'granted'
    | 'denied'
    | 'restricted'

// Permissions API `PermissionState` is 'granted' | 'denied' | 'prompt'. Map
// 'prompt' to 'not-determined' so the renderer's first-use flow triggers the
// getUserMedia prompt (same shape as Electron's 'not-determined').
function mapPermissionState(state: PermissionState): MicrophonePermissionStatus {
    switch (state) {
        case 'granted': return 'granted'
        case 'denied': return 'denied'
        case 'prompt': return 'not-determined'
    }
}

// The two navigator surfaces these functions adapt. Taken as parameters
// (defaulting to the live `navigator`) so the impurity is injected at the edge
// and the mapping is black-box testable without mutating globals — jsdom pins
// `navigator.mediaDevices` as non-configurable, so injection is also the only
// clean way to drive the tests.
type PermissionsLike = Pick<Navigator, 'permissions'>
type MediaLike = Pick<Navigator, 'mediaDevices'>

/**
 * Current microphone permission as seen by the browser. Returns
 * 'not-determined' when the Permissions API is unavailable or the query fails
 * (Firefox/Safari historically don't expose `microphone`), letting the caller
 * fall through to a getUserMedia request which is the real gate.
 */
export async function queryMicrophonePermission(
    nav: PermissionsLike = navigator,
): Promise<MicrophonePermissionStatus> {
    const permissions: Permissions | undefined = nav.permissions
    if (!permissions?.query) return 'not-determined'
    try {
        const status: PermissionStatus = await permissions.query(
            {name: 'microphone' as PermissionName},
        )
        return mapPermissionState(status.state)
    } catch {
        return 'not-determined'
    }
}

/**
 * Request microphone access by opening (and immediately releasing) a capture
 * stream — this is what actually surfaces the browser's permission prompt.
 * Returns true on grant, false on denial/absence of a media device. Mirrors the
 * Electron `requestMicrophonePermission` boolean contract.
 */
export async function requestMicrophoneAccess(
    nav: MediaLike = navigator,
): Promise<boolean> {
    const media: MediaDevices | undefined = nav.mediaDevices
    if (!media?.getUserMedia) return false
    try {
        const stream: MediaStream = await media.getUserMedia({audio: true})
        // Release the device immediately — we only needed the permission grant,
        // the transcription client opens its own stream.
        for (const track of stream.getTracks()) track.stop()
        return true
    } catch {
        return false
    }
}
