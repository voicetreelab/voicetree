import type { ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';

const ELECTRON_CLOSE_MS = 5000;
const GRACEFUL_QUIT_MS = 3000;
const FORCE_KILL_WAIT_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasProcessExited(processHandle: ChildProcess): boolean {
  return processHandle.exitCode !== null || processHandle.signalCode !== null;
}

function isProcessAlive(processHandle: ChildProcess): boolean {
  if (hasProcessExited(processHandle) || !processHandle.pid) return false;

  try {
    process.kill(processHandle.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (!isProcessAlive(processHandle) || !processHandle.pid) return;

  try {
    process.kill(processHandle.pid, signal);
  } catch {
    // The process may have exited between the liveness check and signal.
  }
}

function killProcessGroup(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (!processHandle.pid) return;

  try {
    process.kill(-processHandle.pid, signal);
  } catch {
    signalProcess(processHandle, signal);
  }
}

function waitForProcessExit(processHandle: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(processHandle)) return Promise.resolve(true);

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      processHandle.off('exit', onExit);
      resolve(!isProcessAlive(processHandle));
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };

    processHandle.once('exit', onExit);
  });
}

function releaseProcessHandles(processHandle: ChildProcess): void {
  processHandle.stdout?.destroy();
  processHandle.stderr?.destroy();
  processHandle.stdin?.destroy();

  if (!hasProcessExited(processHandle)) return;

  queueMicrotask(() => {
    processHandle.emit('close', processHandle.exitCode ?? 0, processHandle.signalCode ?? null);
  });
}

export async function closeElectronAppForE2E(electronApp: ElectronApplication): Promise<void> {
  const electronProcess = electronApp.process();
  const close = electronApp.close().catch(() => undefined);
  const closed = await Promise.race([
    close.then(() => true),
    delay(ELECTRON_CLOSE_MS).then(() => false),
  ]);
  if (closed) return;

  if (electronProcess && isProcessAlive(electronProcess)) {
    signalProcess(electronProcess, 'SIGTERM');
    if (!(await waitForProcessExit(electronProcess, GRACEFUL_QUIT_MS))) {
      killProcessGroup(electronProcess, 'SIGKILL');
      await waitForProcessExit(electronProcess, FORCE_KILL_WAIT_MS);
    }
  }

  if (electronProcess) releaseProcessHandles(electronProcess);
  await Promise.race([close, delay(FORCE_KILL_WAIT_MS)]);
}
