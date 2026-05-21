import type { RecorderState } from "@soniox/speech-to-text-web";

// Module-level state for voice recording control
// This bridges the React voice component with the vanilla JS HotkeyManager

type StartFn = () => Promise<void>;
type StopFn = () => void;
type CancelFn = () => void;
type GetStateFn = () => RecorderState;

type VoiceRecordingController = {
    readonly start: StartFn
    readonly stop: StopFn
    readonly cancel: CancelFn
    readonly getState: GetStateFn
}

let controller: VoiceRecordingController | null = null;

/**
 * Initialize the voice recording controller with functions from the React component.
 * Called once by VoiceTreeTranscribe on mount.
 */
export function initVoiceRecording(
    start: StartFn,
    stop: StopFn,
    cancel: CancelFn,
    getState: GetStateFn
): void {
    controller = {start, stop, cancel, getState};
}

/**
 * Cleanup when component unmounts.
 */
export function disposeVoiceRecording(): void {
    controller = null;
}

/**
 * Toggle voice recording on/off. Called by HotkeyManager.
 * When in a transitional state (Stopping/FinishingProcessing/Starting),
 * force-cancels to prevent getting stuck.
 */
export function toggleVoiceRecording(): void {
    if (!controller) {
        console.warn('[VoiceRecordingController] Not initialized');
        return;
    }

    const state: RecorderState = controller.getState();

    if (state === 'Running') {
        controller.stop();
    } else if (state === 'RequestingMedia' || state === 'OpeningWebSocket' || state === 'FinishingProcessing') {
        controller.cancel();
    } else {
        void controller.start();
    }
}
