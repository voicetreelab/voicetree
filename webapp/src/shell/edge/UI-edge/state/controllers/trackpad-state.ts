/**
 * Trackpad gesture state
 *
 * This state is updated from the main process via IPC.
 * The main process uses a native addon (electron-trackpad-detect) that reads
 * NSEvent.hasPreciseScrollingDeltas to reliably detect trackpad vs mouse wheel.
 *
 * hasPreciseScrollingDeltas:
 * - true: continuous scrolling device (trackpad, Magic Mouse)
 * - false: discrete scrolling device (traditional scroll wheel)
 */

let isTrackpadScrolling: boolean = false;

export function getIsTrackpadScrolling(): boolean {
    return isTrackpadScrolling;
}

export function setIsTrackpadScrolling(value: boolean): void {
    isTrackpadScrolling = value;
}
