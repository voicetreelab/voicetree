/**
 * E2E: renderer-keystroke → relay WS → tmux pane round-trip.
 *
 * Gates the BF-313 (xterm.js → relay WS) + M1-fix2 (renderer calls IPC spawn
 * before WS attach) keystroke contract end-to-end against the BUNDLED Electron
 * main process — so a regression in webapp/electron.vite.config.ts that breaks
 * `ws` inbound frame parsing (e.g. an empty bufferutil shim where ws assumes
 * the native accelerator exists, producing `bufferUtil$1.unmask is not a
 * function`) crashes Electron main on the first user keystroke and fails this
 * gate. The renderer-side relay client + the package-level relay→tmux flow
 * have direct unit/integration tests; this spec is specifically the bundled
 * WS server piece that those cannot reach.
 *
 *   1. Spawn an interactive tmux-backed terminal via IPC (ptyBackend='tmux').
 *   2. Open a WebSocket to the relay route the renderer uses
 *      (`/terminals/{terminalId}/attach`) on the unified HTTP daemon.
 *   3. Send `{type: 'data', payload: 'echo <sentinel>\r'}` — the same JSON the
 *      renderer's TerminalRelayClient sends.
 *   4. Assert the sentinel appears in `tmux capture-pane`.
 */

import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  type ExtendedWindow,
  resolveTmuxSessionNameForTest,
  tmuxCommandArgsForTest,
} from './electron-smoke-helpers';
import { test } from './electron-anchor-test-fixtures';
import { getBearerToken } from './helpers/e2e-rpc-helpers';

const KEYSTROKE_SETTLE_TIMEOUT_MS: number = 15_000;

function tmuxCapturePane(sessionName: string, appSupportPath?: string): string {
  try {
    return execFileSync(
      'tmux',
      tmuxCommandArgsForTest(
        ['capture-pane', '-p', '-J', '-S', '-200', '-t', resolveTmuxSessionNameForTest(sessionName, appSupportPath)],
        appSupportPath,
      ),
      { encoding: 'utf8' },
    );
  } catch {
    return '';
  }
}

function tmuxSessionExists(sessionName: string, appSupportPath?: string): boolean {
  try {
    execFileSync(
      'tmux',
      tmuxCommandArgsForTest(
        ['has-session', '-t', resolveTmuxSessionNameForTest(sessionName, appSupportPath)],
        appSupportPath,
      ),
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

function killTmuxSession(sessionName: string, appSupportPath?: string): void {
  try {
    execFileSync(
      'tmux',
      tmuxCommandArgsForTest(
        ['kill-session', '-t', resolveTmuxSessionNameForTest(sessionName, appSupportPath)],
        appSupportPath,
      ),
      { stdio: 'ignore' },
    );
  } catch {
    // already gone
  }
}

async function openRelay(url: string, token: string): Promise<WebSocket> {
  // Subprotocol bearer per packages/systems/vt-daemon/src/transport/wsUpgradeAuth.ts
  // — the renderer (TerminalVanilla.ts) opens the same /terminals/:id/attach
  // route with ['vt-bearer', token]; mirror that wire shape exactly.
  const ws: WebSocket = new WebSocket(url, ['vt-bearer', token]);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', err => reject(err));
  });
  return ws;
}

test.describe('renderer keystroke → relay WS → tmux pane', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('typing in a tmux-backed terminal reaches the pane via the bundled WS relay', async ({ appWindow, fixtureVaultPath }) => {
    test.setTimeout(240_000);

    // Hermetic terminalId so successive runs / parallel tests don't collide.
    const terminalId: string = `e2e-keystroke-${randomBytes(4).toString('hex')}`;
    let appSupportPath: string | undefined;

    try {
      const runtimeInfo: { appSupportPath: string; daemonUrl: string } = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return {
          appSupportPath: await api.main.getAppSupportPath(),
          daemonUrl: await api.main.getDaemonUrl(),
        };
      });
      appSupportPath = runtimeInfo.appSupportPath;
      const daemonWsUrl: string = runtimeInfo.daemonUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
      const token: string = await getBearerToken(appWindow);

      const watchResult = await appWindow.evaluate(async (projectRoot) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return await api.main.startFileWatching(projectRoot);
      }, fixtureVaultPath);
      expect(watchResult.success, 'startFileWatching failed').toBe(true);

      await expect.poll(async () => appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes).length;
      }), {
        message: 'Waiting for graph to load before spawn',
        timeout: 15_000,
        intervals: [250, 500, 1000],
      }).toBeGreaterThan(0);

      const parentNodeId: string = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes)[0];
      });

      // ── Spawn interactive tmux-backed terminal (no agent — just a shell). ──
      const spawnResult = await appWindow.evaluate(async ({ tid, parentNodeId: nodeId }) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api?.terminal) throw new Error('electronAPI.terminal not available');
        return await api.terminal.spawn({
          type: 'Terminal',
          terminalId: tid,
          attachedToContextNodeId: nodeId,
          terminalCount: 0,
          title: 'E2E Keystroke Relay',
          anchoredToNodeId: { _tag: 'None' },
          shadowNodeDimensions: { width: 600, height: 400 },
          resizable: true,
          // No initialCommand — leave the pane at a vanilla shell prompt so
          // we can prove our typed bytes (and only our typed bytes) reached it.
          executeCommand: false,
          isPinned: true,
          isDone: false,
          lastOutputTime: Date.now(),
          activityCount: 0,
          parentTerminalId: null,
          agentName: tid,
          worktreeName: undefined,
          isHeadless: false,
        });
      }, { tid: terminalId, parentNodeId });
      expect(spawnResult.success, `terminal:spawn failed: ${JSON.stringify(spawnResult)}`).toBe(true);

      await expect.poll(() => tmuxSessionExists(terminalId, appSupportPath), {
        timeout: 10_000,
        message: `tmux session ${terminalId} never came up`,
      }).toBe(true);

      // ── Connect to the SAME relay endpoint the renderer uses. ──
      const relayUrl: string = `${daemonWsUrl}/terminals/${encodeURIComponent(terminalId)}/attach?cols=120&rows=40`;
      const ws: WebSocket = await openRelay(relayUrl, token);

      try {
        // Buffer all inbound `data` payloads so we can prove the relay's
        // OUTBOUND path works (server → client → echoed keystrokes).
        let received: string = '';
        let wsClosed: boolean = false;
        let wsError: string | null = null;
        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
          const text: string = Buffer.isBuffer(raw)
            ? raw.toString()
            : Array.isArray(raw)
              ? Buffer.concat(raw).toString()
              : Buffer.from(raw).toString();
          try {
            const parsed = JSON.parse(text) as { type?: string; payload?: string };
            if (parsed.type === 'data' && typeof parsed.payload === 'string') {
              received += parsed.payload;
            }
          } catch {
            // ignore non-JSON frames
          }
        });
        ws.on('close', () => { wsClosed = true; });
        ws.on('error', (err: Error) => { wsError = err.message; });

        // Give tmux's `attach` time to repaint the pane buffer to the client.
        // User shells (zsh + plugins) can take ~1s before they render a
        // prompt; without this settle the test races shell startup, not the
        // relay's keystroke contract.
        await new Promise<void>(r => setTimeout(r, 1500));

        const sentinel: string = `KEYSTROKE_E2E_${randomBytes(3).toString('hex').toUpperCase()}`;

        // Send each character separately to faithfully simulate keystroke
        // pacing — exactly the inbound-frame pattern bufferutil's `.unmask`
        // crash used to trigger on.
        const line: string = `echo ${sentinel}\r`;
        for (const ch of line) {
          ws.send(JSON.stringify({ type: 'data', payload: ch }));
        }

        // Both (a) the pane echoes our keystrokes back over the WS (inbound
        // frame parsed → forwarded to pty → pty output → outbound frame),
        // AND (b) the shell executes `echo` so the sentinel appears in the
        // pane buffer.
        await expect.poll(() => received.includes(sentinel) && tmuxCapturePane(terminalId, appSupportPath).includes(sentinel), {
          timeout: KEYSTROKE_SETTLE_TIMEOUT_MS,
          intervals: [200, 500, 1000],
          message: `keystrokes never produced "${sentinel}" — relay WS inbound path is broken. wsClosed=${wsClosed} wsError=${wsError}. capture-pane:\n${tmuxCapturePane(terminalId, appSupportPath)}\nReceived from relay (${received.length} bytes):\n${received}`,
        }).toBe(true);
      } finally {
        ws.close();
      }
    } finally {
      // Defensive cleanup — the tmux session is detached from the relay's
      // pty, so closing the WS alone won't kill it.
      if (tmuxSessionExists(terminalId, appSupportPath)) killTmuxSession(terminalId, appSupportPath);
    }
  });
});
