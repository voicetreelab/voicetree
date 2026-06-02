/**
 * E2E: renderer-keystroke → IPC bridge → Main /terminals/:id/attach WS → tmux pane.
 *
 * Gates the BF-313 (xterm.js → relay) + M1-fix2 (renderer calls IPC spawn
 * before attach) + BF-368 (renderer attaches via Main IPC, not direct WS)
 * keystroke contract end-to-end against the BUNDLED Electron main process —
 * so a regression in webapp/electron.vite.config.ts or the Main-owned
 * `vtTerminalAttachBridge` crashes Electron main on the first user keystroke
 * and fails this gate.
 *
 *   1. Spawn an interactive tmux-backed terminal via IPC (ptyBackend='tmux').
 *   2. Call `hostAPI.terminal.attach(terminalId)` to obtain an opaque
 *      handle id; subscribe to `terminal:data` over the same surface.
 *   3. Send `hostAPI.terminal.write(handle, char)` per character — same
 *      surface TerminalVanilla.ts uses.
 *   4. Assert the sentinel appears in `tmux capture-pane`.
 */

import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  type ExtendedWindow,
  resolveTmuxSessionNameForTest,
  tmuxCommandArgsForTest,
} from './electron-smoke-helpers';
import { test } from './electron-anchor-test-fixtures';

const KEYSTROKE_SETTLE_TIMEOUT_MS: number = 15_000;

function tmuxCapturePane(sessionName: string, voicetreeHomePath?: string): string {
  try {
    return execFileSync(
      'tmux',
      tmuxCommandArgsForTest(
        ['capture-pane', '-p', '-J', '-S', '-200', '-t', resolveTmuxSessionNameForTest(sessionName, voicetreeHomePath)],
        voicetreeHomePath,
      ),
      { encoding: 'utf8' },
    );
  } catch {
    return '';
  }
}

function tmuxSessionExists(sessionName: string, voicetreeHomePath?: string): boolean {
  try {
    execFileSync(
      'tmux',
      tmuxCommandArgsForTest(
        ['has-session', '-t', resolveTmuxSessionNameForTest(sessionName, voicetreeHomePath)],
        voicetreeHomePath,
      ),
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

function killTmuxSession(sessionName: string, voicetreeHomePath?: string): void {
  try {
    execFileSync(
      'tmux',
      tmuxCommandArgsForTest(
        ['kill-session', '-t', resolveTmuxSessionNameForTest(sessionName, voicetreeHomePath)],
        voicetreeHomePath,
      ),
      { stdio: 'ignore' },
    );
  } catch {
    // already gone
  }
}

declare global {
  interface Window {
    __e2eKeystrokeRelay?: {
      readonly handle: string;
      readonly received: { value: string };
      readonly detach: () => Promise<void>;
    };
  }
}

test.describe('renderer keystroke → Main IPC → /terminals/:id/attach WS → tmux pane', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('typing in a tmux-backed terminal reaches the pane via the Main-owned IPC bridge', async ({ appWindow }) => {
    test.setTimeout(240_000);

    let voicetreeHomePath: string | undefined;
    let terminalId: string | undefined;

    try {
      voicetreeHomePath = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api) throw new Error('hostAPI not available');
        return api.main.getVoicetreeHomePath();
      });

      await expect.poll(async () => appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api) throw new Error('hostAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes).length;
      }), {
        message: 'Waiting for graph to load before spawn',
        timeout: 15_000,
        intervals: [250, 500, 1000],
      }).toBeGreaterThan(0);

      const parentNodeId: string = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api) throw new Error('hostAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes)[0];
      });

      // ── Spawn an interactive tmux-backed plain shell on the parent node. ──
      // `spawnPlainTerminal` opens a vanilla pty without running an agent
      // command — exactly the shape we need to prove typed bytes reach the
      // pane. The daemon assigns the terminalId, surfaced to the renderer via
      // the `terminal-registry` SSE topic; we observe the resulting floating
      // window in the DOM to learn that id.
      await appWindow.evaluate(async ({ parentNodeId: nodeId }) => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api) throw new Error('hostAPI not available');
        await api.main.spawnPlainTerminal({ nodeId, terminalCount: 0 });
      }, { parentNodeId });

      terminalId = await appWindow.evaluate(async () => {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const elem = document.querySelector('.cy-floating-window-terminal');
          const id = elem?.getAttribute('data-floating-window-id');
          if (id) return id;
          await new Promise(r => setTimeout(r, 250));
        }
        throw new Error('Spawned terminal never appeared in the DOM');
      });

      const liveTerminalId: string = terminalId;

      await expect.poll(() => tmuxSessionExists(liveTerminalId, voicetreeHomePath), {
        timeout: 10_000,
        message: `tmux session ${liveTerminalId} never came up`,
      }).toBe(true);

      // ── Attach via the SAME IPC bridge the renderer uses. ──
      await appWindow.evaluate(async (tid: string) => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api?.terminal) throw new Error('hostAPI.terminal not available');
        const handle: string = await api.terminal.attach(tid);
        const received: { value: string } = { value: '' };
        const offData = api.terminal.onData(handle, (data: string): void => {
          received.value += data;
        });
        window.__e2eKeystrokeRelay = {
          handle,
          received,
          detach: async (): Promise<void> => {
            offData();
            await api.terminal.detach(handle);
          },
        };
      }, liveTerminalId);

      try {
        // Give tmux's `attach` time to repaint the pane buffer to the client.
        // User shells (zsh + plugins) can take ~1s before they render a
        // prompt; without this settle the test races shell startup, not the
        // relay's keystroke contract.
        await new Promise<void>(r => setTimeout(r, 1500));

        const sentinel: string = `KEYSTROKE_E2E_${randomBytes(3).toString('hex').toUpperCase()}`;
        const line: string = `echo ${sentinel}\r`;

        // Send each character separately to faithfully simulate keystroke
        // pacing — same shape TerminalVanilla.ts uses on real user input.
        await appWindow.evaluate(async ({ line: typed }) => {
          const api = (window as ExtendedWindow).hostAPI;
          const bridge = window.__e2eKeystrokeRelay;
          if (!api?.terminal || !bridge) throw new Error('relay bridge not installed');
          for (const ch of typed) {
            await api.terminal.write(bridge.handle, ch);
          }
        }, { line });

        await expect.poll(async () => {
          const received: string = await appWindow.evaluate(() => window.__e2eKeystrokeRelay?.received.value ?? '');
          const onPane: string = tmuxCapturePane(liveTerminalId, voicetreeHomePath);
          return received.includes(sentinel) && onPane.includes(sentinel);
        }, {
          timeout: KEYSTROKE_SETTLE_TIMEOUT_MS,
          intervals: [200, 500, 1000],
          message: `keystrokes never produced "${sentinel}" via IPC relay. capture-pane:\n${tmuxCapturePane(liveTerminalId, voicetreeHomePath)}`,
        }).toBe(true);
      } finally {
        await appWindow.evaluate(async () => {
          await window.__e2eKeystrokeRelay?.detach();
          delete window.__e2eKeystrokeRelay;
        });
      }
    } finally {
      // Defensive cleanup — the tmux session is detached from the relay's
      // pty, so closing the IPC handle alone won't kill it.
      if (terminalId && tmuxSessionExists(terminalId, voicetreeHomePath)) {
        killTmuxSession(terminalId, voicetreeHomePath);
      }
    }
  });
});
