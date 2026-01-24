/**
 * Trackpad gesture state - simple boolean for tracking active trackpad scroll
 *
 * This state is set by the main process via uiAPI when macOS gesture events fire.
 * NavigationGestureService reads this to distinguish trackpad scroll (pan) from mouse wheel (zoom).
 */

let isTrackpadScrolling: boolean = false;

export function getIsTrackpadScrolling(): boolean {
    return isTrackpadScrolling;
}

export function setIsTrackpadScrolling(value: boolean): void {
    isTrackpadScrolling = value;
}
