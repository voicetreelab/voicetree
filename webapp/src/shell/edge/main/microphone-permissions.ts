/**
 * Microphone permission utilities for Electron main process.
 * Handles macOS-specific permission APIs with cross-platform fallbacks.
 */
import { systemPreferences, shell } from 'electron';

export type MicrophonePermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted';

/**
 * Check current microphone permission status.
 * On non-macOS platforms, returns 'granted' (no system-level mic permissions).
 */
export function checkMicrophonePermission(): MicrophonePermissionStatus {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('microphone');
  }
  return 'granted';
}

/**
 * Request microphone permission from the user.
 * Shows native macOS permission dialog if status is 'not-determined'.
 * Returns true if permission granted, false otherwise.
 * On non-macOS platforms, always returns true.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return systemPreferences.askForMediaAccess('microphone');
  }
  return true;
}

/**
 * Open system settings to the microphone permissions panel.
 * Allows user to manually grant permission after denying.
 * Only functional on macOS.
 */
export function openMicrophoneSettings(): void {
  if (process.platform === 'darwin') {
    // Opens System Settings > Privacy & Security > Microphone
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    );
  }
  // Windows/Linux: No equivalent system settings page for mic permissions
}
