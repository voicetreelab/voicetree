/**
 * E2E: renderer wheel event → TerminalVanilla customWheelHandler → relay scroll
 *       RPC → `tmux copy-mode -e ; send-keys -X scroll-up`.
 *
 * Proves the full chain wired by the side-channel scroll fix:
 *   1. Dispatching a real WheelEvent on `.xterm-viewport` triggers our
 *      attachCustomWheelEventHandler.
 *   2. The handler calls relayClient.sendScroll(...).
 *   3. The relay's `{type:'scroll'}` handler runs the tmux commands.
 *   4. tmux enters copy-mode (pane_in_mode flips 0 → 1).
 *   5. Scrolling back down past the live view auto-exits copy-mode via the
 *      `copy-mode -e` flag (pane_in_mode flips 1 → 0).
 *
 * The pane is seeded with `seq 1 400` (via `tmux send-keys` directly, bypassing
 * the renderer) so there is actually scrollback to scroll into.
 *
 * Screenshots are dumped to e2e-tests/screenshots/ for human review only —
 * they are NOT asserted on, since PTY content is unreliable for pixel-diff
 * per the e2e-testing skill.
 */

import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  type ExtendedWindow,
  tmuxCommandArgsForTest,
  waitForMcpServer,
} from './electron-smoke-helpers';
import { test } from './electron-anchor-test-fixtures';

const SCROLL_SETTLE_TIMEOUT_MS: number = 10_000;

function tmuxListSessions(appSupportPath?: string): string[] {
  try {
    return execFileSync(
      'tmux',
      tmuxCommandArgsForTest(['list-sessions', '-F', '#S'], appSupportPath),
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function tmuxDisplay(sessionName: string, format: string, appSupportPath?: string): string {
  try {
    return execFileSync(
      'tmux',
      tmuxCommandArgsForTest(['display-message', '-p', '-t', sessionName, format], appSupportPath),
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

function tmuxCapturePane(sessionName: string, appSupportPath?: string): string {
  try {
    return execFileSync(
      'tmux',
      tmuxCommandArgsForTest(['capture-pane', '-p', '-J', '-S', '-200', '-t', sessionName], appSupportPath),
      { encoding: 'utf8' },
    );
  } catch {
    return '';
  }
}

function tmuxSendKeys(sessionName: string, keys: string[], appSupportPath?: string): void {
  execFileSync(
    'tmux',
    tmuxCommandArgsForTest(['send-keys', '-t', sessionName, ...keys], appSupportPath),
    { stdio: 'ignore' },
  );
}

function killTmuxSession(sessionName: string, appSupportPath?: string): void {
  try {
    execFileSync(
      'tmux',
      tmuxCommandArgsForTest(['kill-session', '-t', sessionName], appSupportPath),
      { stdio: 'ignore' },
    );
  } catch {
    // already gone
  }
}

test.describe('renderer wheel → tmux scrollback', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('WheelEvent on xterm viewport enters tmux copy-mode and exits on scroll-down past live', async ({ appWindow, fixtureVaultPath }) => {
    test.setTimeout(240_000);

    let appSupportPath: string | undefined;
    let sessionName: string | undefined;

    try {
      // ── Bring up MCP + file watcher + graph. ──
      const runtimeInfo: { appSupportPath: string; mcpPort: number } = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return {
          appSupportPath: await api.main.getAppSupportPath(),
          mcpPort: await api.main.getMcpPort(),
        };
      });
      appSupportPath = runtimeInfo.appSupportPath;
      expect(await waitForMcpServer(`http://127.0.0.1:${runtimeInfo.mcpPort}/mcp`)).toBe(true);

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

      // ── Spawn via spawnPlainTerminal so the renderer's launchTerminalOntoUI
      // path runs end-to-end (this is what mounts TerminalVanilla and attaches
      // our customWheelHandler). ──
      await appWindow.evaluate(async (nodeId: string) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.spawnPlainTerminal(nodeId, 0);
      }, parentNodeId);

      const viewportSelector: string = '.cy-floating-window-terminal .xterm-viewport';
      await appWindow.waitForSelector(viewportSelector, { state: 'visible', timeout: 15_000 });
      await appWindow.waitForSelector('.cy-floating-window-terminal .terminal-relay-status.connected', {
        state: 'visible',
        timeout: 15_000,
      });

      // The test vault is isolated (anchor fixture mints a temp dir), so the
      // first tmux session on this socket is ours.
      await expect.poll(() => tmuxListSessions(appSupportPath).length, {
        timeout: 10_000,
        message: 'no tmux session ever materialised for the spawned terminal',
      }).toBeGreaterThan(0);
      // There's a `__voicetree_root__` housekeeping session plus our floating
      // terminal's `vt-…` session — pick the latter.
      const allSessions: string[] = tmuxListSessions(appSupportPath);
      sessionName = allSessions.find((s: string) => s.startsWith('vt-'));
      if (!sessionName) throw new Error('no vt-prefixed tmux session found; sessions=' + allSessions.join(','));

      // ── Seed scrollback. `seq 1 400` plus a typical 40-row pane guarantees
      // there is history to scroll up into. Send via tmux directly — we want
      // the renderer-side xterm flow untouched until the wheel test itself. ──
      tmuxSendKeys(sessionName, ['seq 1 400', 'Enter'], appSupportPath);

      await expect.poll(() => tmuxCapturePane(sessionName!, appSupportPath).includes('400'), {
        timeout: SCROLL_SETTLE_TIMEOUT_MS,
        intervals: [200, 500, 1000],
        message: 'seq 1 400 output never reached the pane buffer',
      }).toBe(true);

      // Sanity: not in copy-mode before we touch the wheel.
      expect(tmuxDisplay(sessionName, '#{pane_in_mode}', appSupportPath)).toBe('0');

      await appWindow.screenshot({
        path: 'e2e-tests/screenshots/wheel-scroll-01-pre-wheel.png',
      });

      // ── Focus the floating terminal. NavigationGestureService listens for
      // wheel events on document in CAPTURE mode and redirects them to graph
      // zoom/pan when the floating window is unfocused — that would short-
      // circuit xterm's wheel handler (and ours). Focusing the xterm textarea
      // makes the floating window the activeElement's container, so the
      // navigation gesture lets the wheel reach xterm. ──
      await appWindow.evaluate(() => {
        const textarea: HTMLTextAreaElement | null = document.querySelector('.cy-floating-window-terminal .xterm-helper-textarea');
        textarea?.focus();
      });

      // ── Dispatch synthetic WheelEvents directly on the .xterm root element.
      // xterm.js installs its wheel listener on `term.element` (the .xterm
      // root); dispatching there fires the handler synchronously regardless
      // of window visibility or z-index stacking — both of which would
      // otherwise defeat a real OS-level wheel because MINIMIZE_TEST=1 hides
      // the window and the folder-tree-container sits on top at the
      // viewport's screen coords. deltaY = -120 ≈ one mouse notch; the
      // handler converts |deltaY|/40 ≈ 3 lines per notch. ──
      const dispatched: boolean = await appWindow.evaluate(() => {
        const root: HTMLElement | null = document.querySelector('.cy-floating-window-terminal .xterm');
        if (!root) return false;
        for (let i = 0; i < 3; i++) {
          root.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
        }
        return true;
      });
      expect(dispatched, '.xterm root not found for wheel dispatch').toBe(true);

      await expect.poll(() => tmuxDisplay(sessionName!, '#{pane_in_mode}', appSupportPath), {
        timeout: SCROLL_SETTLE_TIMEOUT_MS,
        intervals: [50, 100, 200, 500],
        message: () => `tmux never entered copy-mode after WheelEvent.\ncapture-pane:\n${tmuxCapturePane(sessionName!, appSupportPath)}`,
      }).toBe('1');

      await appWindow.screenshot({
        path: 'e2e-tests/screenshots/wheel-scroll-02-in-copy-mode.png',
      });

      // ── Drive scroll-down past the live view to auto-exit copy-mode
      // (the `-e` flag on `copy-mode`). Big positive deltas. ──
      await appWindow.evaluate(() => {
        const root: HTMLElement | null = document.querySelector('.cy-floating-window-terminal .xterm');
        if (!root) return;
        for (let i = 0; i < 8; i++) {
          root.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 1200,
            bubbles: true,
            cancelable: true,
          }));
        }
      });

      await expect.poll(() => tmuxDisplay(sessionName!, '#{pane_in_mode}', appSupportPath), {
        timeout: SCROLL_SETTLE_TIMEOUT_MS,
        intervals: [50, 100, 200, 500],
        message: () => `tmux did not auto-exit copy-mode after scrolling past live view.\ncapture-pane:\n${tmuxCapturePane(sessionName!, appSupportPath)}`,
      }).toBe('0');

      await appWindow.screenshot({
        path: 'e2e-tests/screenshots/wheel-scroll-03-back-to-live.png',
      });
    } finally {
      if (sessionName) killTmuxSession(sessionName, appSupportPath);
    }
  });
});
