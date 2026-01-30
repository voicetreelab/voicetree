import type { RecorderState } from "@soniox/speech-to-text-web";

// Module-level state for voice recording control
// This bridges the React voice component with the vanilla JS HotkeyManager

type StartFn = () => Promise<void>;
type StopFn = () => void;
type GetStateFn = () => RecorderState;

let startTranscription: StartFn | null = null;
let stopTranscription: StopFn | null = null;
let getRecorderState: GetStateFn | null = null;

/**
 * Initialize the voice recording controller with functions from the React component.
 * Called once by VoiceTreeTranscribe on mount.
 */
export function initVoiceRecording(
    start: StartFn,
    stop: StopFn,
    getState: GetStateFn
): void {
    startTranscription = start;
    stopTranscription = stop;
    getRecorderState = getState;
}

/**
 * Cleanup when component unmounts.
 */
export function disposeVoiceRecording(): void {
    startTranscription = null;
    stopTranscription = null;
    getRecorderState = null;
}

/**
 * Toggle voice recording on/off. Called by HotkeyManager.
 */
export function toggleVoiceRecording(): void {
    if (!startTranscription || !stopTranscription || !getRecorderState) {
        console.warn('[VoiceRecordingController] Not initialized');
        return;
    }

    const state: RecorderState = getRecorderState();

    if (state === 'Running') {
        stopTranscription();
    } else {
        void startTranscription();
    }
}

/**
 * Check if voice recording is currently active.
 */
export function isVoiceRecording(): boolean {
    if (!getRecorderState) return false;
    return getRecorderState() === 'Running';
}
