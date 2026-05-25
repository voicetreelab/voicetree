import type { ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'child_process';

const GRACEFUL_QUIT_MS = 3000;
const ELECTRON_CLOSE_MS = 5000;
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

// SIGKILL the whole process group via `-pid`. Playwright launches Electron
// with `detached:true`, making it the group leader; signalling the group
// reaches every descendant that has not daemonized away. Killing only `pid`
// would leave inheriting helpers alive holding the stdout/stderr pipes open
// and prolong the teardown budget below.
function killProcessGroup(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (!processHandle.pid) return;
  try {
    process.kill(-processHandle.pid, signal);
  } catch {
    // Group already gone or platform does not support group signalling.
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

// Close the Electron app deterministically:
//   1) start `electronApp.close()` so Playwright drives the quit through its
//      own channel (and drops the tracked-apps entry on its own when it can)
//   2) if it does not return in ELECTRON_CLOSE_MS, escalate: SIGTERM -> SIGKILL
//      of the process group
//   3) synthesize `child_process` "close" once we have proven the OS process
//      exited, so Playwright's internal `waitForCleanup` resolves immediately
//      (see comment on the emit below for why this is necessary)
//   4) re-await the original close call so any remaining bookkeeping settles
export async function closeElectronAppForSmoke(
  electronApp: ElectronApplication,
  electronProcess: ChildProcess | null
): Promise<void> {
  const close = electronApp.close().catch(() => undefined);
  const closed = await Promise.race([
    close.then(() => true),
    delay(ELECTRON_CLOSE_MS).then(() => false)
  ]);
  if (closed || !electronProcess) return;

  signalProcess(electronProcess, 'SIGTERM');
  if (!(await waitForProcessExit(electronProcess, GRACEFUL_QUIT_MS))) {
    killProcessGroup(electronProcess, 'SIGKILL');
    await waitForProcessExit(electronProcess, FORCE_KILL_WAIT_MS);
  }

  // Release Node's own handles on the spawned process's stdio. Without this,
  // Playwright's internal `readline.createInterface({ input: stdout })` keeps
  // consuming the pipe and the `child_process` "close" event never fires.
  electronProcess.stdout?.destroy();
  electronProcess.stderr?.destroy();
  electronProcess.stdin?.destroy();

  // Synthesize `child_process` "close" once we have confirmed the OS process
  // exited. Reason: Node fires "close" only after BOTH the process exits AND
  // its stdio FDs are fully closed in the kernel. Electron's helper processes
  // (renderer / GPU / utility) inherit the parent's stdout/stderr; even after
  // a process-group SIGKILL, one of those FDs reliably outlives the worker
  // teardown budget here, so Node never fires the event. Playwright's
  // `gracefullyClose` then awaits a Promise that resolves on that event
  // (`waitForCleanup`), and worker teardown burns its full 30s budget waiting
  // for an exit signal we already know happened. We emit `close` ourselves
  // with the real `exitCode`/`signalCode` captured from the dead process -
  // semantically equivalent to the event Node would have eventually emitted,
  // just not 30s late.
  if (hasProcessExited(electronProcess)) {
    queueMicrotask(() => {
      const exitCode = electronProcess.exitCode ?? 0;
      const signal = electronProcess.signalCode ?? null;
      electronProcess.emit('close', exitCode, signal);
    });
  }

  await Promise.race([close, delay(FORCE_KILL_WAIT_MS)]);
}
