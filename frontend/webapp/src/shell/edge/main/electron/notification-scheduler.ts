import { app, Notification, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

// Notification intervals in days since last use
const NOTIFICATION_INTERVALS_DAYS: readonly number[] = [2, 7, 14];
const DISMISS_THRESHOLD: number = 2;
const CHECK_INTERVAL_MS: number = 60 * 60 * 1000; // 1 hour

interface NotificationState {
  readonly lastUsedTimestamp: number;
  readonly notificationsSent: number;
  readonly dismissCount: number;
  readonly permanentlyDisabled: boolean;
}

const DEFAULT_STATE: NotificationState = {
  lastUsedTimestamp: Date.now(),
  notificationsSent: 0,
  dismissCount: 0,
  permanentlyDisabled: false,
};

let checkInterval: NodeJS.Timeout | null = null;

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'notification-state.json');
}

async function loadNotificationState(): Promise<NotificationState> {
  try {
    const data: string = await fs.readFile(getStatePath(), 'utf-8');
    const parsed: Partial<NotificationState> = JSON.parse(data) as Partial<NotificationState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveNotificationState(DEFAULT_STATE);
      return DEFAULT_STATE;
    }
    throw error;
  }
}

async function saveNotificationState(state: NotificationState): Promise<void> {
  const statePath: string = getStatePath();
  const stateDir: string = path.dirname(statePath);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function daysSinceTimestamp(timestamp: number): number {
  const msPerDay: number = 24 * 60 * 60 * 1000;
  return (Date.now() - timestamp) / msPerDay;
}

/**
 * Record that the user actively used the app.
 * Called when window gains focus.
 * Resets dismiss count since user returned.
 */
export async function recordAppUsage(): Promise<void> {
  const state: NotificationState = await loadNotificationState();
  const updatedState: NotificationState = {
    ...state,
    lastUsedTimestamp: Date.now(),
    dismissCount: 0, // User returned, reset dismiss count
  };
  await saveNotificationState(updatedState);
  console.log('[Notifications] Recorded app usage');
}

/**
 * Show the re-engagement notification.
 * Returns true if notification was shown, false otherwise.
 */
function showNotification(): boolean {
  if (!Notification.isSupported()) {
    console.log('[Notifications] Notifications not supported on this platform');
    return false;
  }

  const notification: Notification = new Notification({
    title: 'VoiceTree',
    body: 'Might VoiceTree help you here?',
    silent: false,
  });

  notification.on('click', () => {
    console.log('[Notifications] User clicked notification');
    // Bring app to foreground
    const windows: BrowserWindow[] = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow: BrowserWindow = windows[0];
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
    // Record usage since user engaged
    void recordAppUsage();
  });

  notification.on('close', () => {
    console.log('[Notifications] Notification dismissed');
    // Handle dismiss - increment counter
    void handleNotificationDismissed();
  });

  notification.show();
  return true;
}

/**
 * Handle notification being dismissed without user clicking.
 */
async function handleNotificationDismissed(): Promise<void> {
  const state: NotificationState = await loadNotificationState();
  const newDismissCount: number = state.dismissCount + 1;
  const shouldDisable: boolean = newDismissCount >= DISMISS_THRESHOLD;

  const updatedState: NotificationState = {
    ...state,
    dismissCount: newDismissCount,
    permanentlyDisabled: shouldDisable,
  };
  await saveNotificationState(updatedState);

  if (shouldDisable) {
    console.log('[Notifications] Permanently disabled after repeated dismissals');
  }
}

/**
 * Check if a notification should be shown and show it if appropriate.
 */
export async function checkAndShowNotification(): Promise<void> {
  // Skip in test mode
  if (process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') {
    return;
  }

  const state: NotificationState = await loadNotificationState();

  // Check if permanently disabled
  if (state.permanentlyDisabled) {
    console.log('[Notifications] Skipping - permanently disabled');
    return;
  }

  // Check if we've sent all notifications
  if (state.notificationsSent >= NOTIFICATION_INTERVALS_DAYS.length) {
    console.log('[Notifications] Skipping - all notifications sent');
    return;
  }

  // Get the current interval threshold
  const currentIntervalDays: number = NOTIFICATION_INTERVALS_DAYS[state.notificationsSent];
  const daysSinceUse: number = daysSinceTimestamp(state.lastUsedTimestamp);

  console.log(`[Notifications] Days since use: ${daysSinceUse.toFixed(2)}, threshold: ${currentIntervalDays}`);

  // Check if enough time has passed
  if (daysSinceUse < currentIntervalDays) {
    return;
  }

  // Show notification
  const shown: boolean = showNotification();
  if (shown) {
    const updatedState: NotificationState = {
      ...state,
      notificationsSent: state.notificationsSent + 1,
    };
    await saveNotificationState(updatedState);
    console.log(`[Notifications] Showed notification ${updatedState.notificationsSent}/${NOTIFICATION_INTERVALS_DAYS.length}`);
  }
}

/**
 * Start the notification scheduler.
 * Checks periodically if a notification should be shown.
 */
export function startNotificationScheduler(): void {
  // Skip in test mode
  if (process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') {
    console.log('[Notifications] Skipping scheduler in test mode');
    return;
  }

  console.log('[Notifications] Starting notification scheduler');

  // Check immediately on startup
  void checkAndShowNotification();

  // Then check every hour
  checkInterval = setInterval(() => {
    void checkAndShowNotification();
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the notification scheduler.
 */
export function stopNotificationScheduler(): void {
  if (checkInterval !== null) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log('[Notifications] Stopped notification scheduler');
  }
}

// Export for testing
interface TestingExports {
  readonly loadNotificationState: () => Promise<NotificationState>;
  readonly saveNotificationState: (state: NotificationState) => Promise<void>;
  readonly daysSinceTimestamp: (timestamp: number) => number;
  readonly NOTIFICATION_INTERVALS_DAYS: readonly number[];
  readonly DISMISS_THRESHOLD: number;
  readonly DEFAULT_STATE: NotificationState;
  readonly getStatePath: () => string;
}

export const _testing: TestingExports = {
  loadNotificationState,
  saveNotificationState,
  daysSinceTimestamp,
  NOTIFICATION_INTERVALS_DAYS,
  DISMISS_THRESHOLD,
  DEFAULT_STATE,
  getStatePath,
};
