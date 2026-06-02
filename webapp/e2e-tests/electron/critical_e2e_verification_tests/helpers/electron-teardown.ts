import type { ElectronApplication } from '@playwright/test';
import { kill as sendProcessSignal } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const SHUTDOWN_IPC_TIMEOUT_MS = 2500;
const FIRST_WINDOW_TIMEOUT_MS = 1000;
const APP_QUIT_TIMEOUT_MS = 2500;
const ELECTRON_CLOSE_TIMEOUT_MS = 5000;
const PROCESS_EXIT_TIMEOUT_MS = 2000;

type ElectronProcess = NonNullable<ReturnType<ElectronApplication['process']>>;

function hasProcessExited(proc: ElectronProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function isProcessStillAlive(proc: ElectronProcess): boolean {
  if (hasProcessExited(proc) || !proc.pid) return false;
  try {
    sendProcessSignal(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(proc: ElectronProcess): Promise<void> {
  if (!isProcessStillAlive(proc)) return;
  await Promise.race([
    new Promise<void>((resolve) => proc.once('exit', () => resolve())),
    delay(PROCESS_EXIT_TIMEOUT_MS),
  ]);
}

function signalProcess(proc: ElectronProcess, signal: NodeJS.Signals): void {
  if (!isProcessStillAlive(proc) || !proc.pid) return;
  try {
    sendProcessSignal(proc.pid, signal);
  } catch {
    // The process may have exited between the liveness check and signal.
  }
}

function signalProcessGroup(proc: ElectronProcess, signal: NodeJS.Signals): void {
  if (!proc.pid) return;
  try {
    sendProcessSignal(-proc.pid, signal);
  } catch {
    signalProcess(proc, signal);
  }
}

function releaseProcessHandles(proc: ElectronProcess): void {
  proc.stdout?.destroy();
  proc.stderr?.destroy();
  proc.stdin?.destroy();

  if (isProcessStillAlive(proc)) return;
  queueMicrotask(() => {
    proc.emit('close', proc.exitCode ?? 0, proc.signalCode ?? null);
  });
}

async function requestAppQuit(electronApp: ElectronApplication): Promise<void> {
  await Promise.race([
    electronApp
      .evaluate(({ app }) => {
        app.quit();
      })
      .catch(() => undefined),
    delay(APP_QUIT_TIMEOUT_MS).then(() => undefined),
  ]);
}

async function runBoundedShutdownIpc(
  electronApp: ElectronApplication,
  method: 'shutdownGraphDaemon' | 'stopFileWatching',
): Promise<void> {
  const proc = electronApp.process();
  if (proc && !isProcessStillAlive(proc)) return;

  const page = await Promise.race([
    electronApp.firstWindow({ timeout: FIRST_WINDOW_TIMEOUT_MS }).catch(() => null),
    delay(FIRST_WINDOW_TIMEOUT_MS).then(() => null),
  ]);
  if (!page) return;

  await Promise.race([
    page
      .evaluate(
        async ({ methodName, timeoutMs }) => {
          type ShutdownMethod = 'shutdownGraphDaemon' | 'stopFileWatching';
          const api = (
            window as unknown as {
              hostAPI?: {
                main: Partial<Record<ShutdownMethod, () => Promise<unknown>>>;
              };
            }
          ).hostAPI;
          const shutdown = api?.main[methodName as ShutdownMethod];
          if (!shutdown) return;

          await Promise.race([
            shutdown(),
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
          ]);
        },
        { methodName: method, timeoutMs: SHUTDOWN_IPC_TIMEOUT_MS },
      )
      .catch(() => undefined),
    delay(SHUTDOWN_IPC_TIMEOUT_MS).then(() => undefined),
  ]);
}

async function safeDaemonShutdown(
  electronApp: ElectronApplication,
): Promise<void> {
  try {
    await runBoundedShutdownIpc(electronApp, 'shutdownGraphDaemon');
  } catch {
    // Window may already be closed or app in bad state.
  }
}

async function safeStopFileWatching(
  electronApp: ElectronApplication,
): Promise<void> {
  try {
    await runBoundedShutdownIpc(electronApp, 'stopFileWatching');
  } catch {
    // Window may already be closed or app in bad state.
  }
}

async function robustElectronTeardown(
  electronApp: ElectronApplication,
): Promise<void> {
  await safeDaemonShutdown(electronApp);

  const proc = electronApp.process();
  if (proc && !isProcessStillAlive(proc)) {
    await Promise.race([
      electronApp.close().catch(() => undefined),
      delay(PROCESS_EXIT_TIMEOUT_MS).then(() => undefined),
    ]);
    releaseProcessHandles(proc);
    return;
  }

  await requestAppQuit(electronApp);

  const close = electronApp.close().catch(() => undefined);
  const closed = await Promise.race([
    close.then(() => true),
    delay(ELECTRON_CLOSE_TIMEOUT_MS).then(() => false),
  ]);

  if (closed) return;

  if (proc) {
    signalProcess(proc, 'SIGTERM');
    await waitForProcessExit(proc);
    if (isProcessStillAlive(proc)) signalProcessGroup(proc, 'SIGKILL');
    await waitForProcessExit(proc);
    releaseProcessHandles(proc);
  }
  await Promise.race([close, delay(PROCESS_EXIT_TIMEOUT_MS)]);
}

export const electronTeardown = {
  robustElectronTeardown,
  safeStopFileWatching,
} as const;
