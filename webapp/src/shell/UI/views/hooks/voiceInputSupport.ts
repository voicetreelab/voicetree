// Whether this browser can capture microphone audio for Soniox transcription.
//
// Browser audio capture goes through `navigator.mediaDevices.getUserMedia`,
// which the web platform exposes ONLY in a secure context — HTTPS, or a
// localhost origin. Over plain http on a LAN IP (the `vt webapp --lan` phone
// case, opened at `http://192.168.0.98:3000`) the context is insecure, so
// `navigator.mediaDevices` is undefined and the Soniox SDK constructor throws
// synchronously. Constructing the client during render (as the transcribe hook
// did) turned that throw into an unhandled render error that crashed the whole
// <VoiceTreeTranscribe> subtree — looking, to the user, like "the LAN app won't
// connect" even though the graph and agent spawning work fine.
//
// Gating on the same precondition the platform enforces lets voice degrade to
// "unavailable" (dimmed mic + a one-line explanation) instead of crashing.
//
// `voiceInputSupported` is the pure decision; `detectVoiceInputSupport` is the
// thin reader that samples the browser globals at the impure edge.

export interface VoiceInputEnv {
    readonly isSecureContext: boolean
    readonly hasGetUserMedia: boolean
}

export function voiceInputSupported(env: VoiceInputEnv): boolean {
    return env.isSecureContext && env.hasGetUserMedia
}

export function detectVoiceInputSupport(): boolean {
    return voiceInputSupported({
        isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
        hasGetUserMedia:
            typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    })
}
