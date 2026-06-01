/**
 * Main process CPU profiling via Node inspector debugger protocol.
 *
 * Connects to Electron's main process debugger (--inspect) via WebSocket CDP,
 * then uses V8's Profiler domain to capture sampling CPU profiles.
 *
 * Produces `.cpuprofile` files openable in:
 *   - Chrome DevTools > Performance tab (drag & drop)
 *   - VS Code (click to open)
 *   - https://www.speedscope.app
 */

import type { ElectronApplication } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import WebSocket from 'ws';

// ============================================================================
// CDP-over-WebSocket connection to the main process debugger
// ============================================================================

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class MainProcessCDP {
  private ws: WebSocket;
  private msgId = 0;
  private pending = new Map<number, { resolve: (v: CDPResponse) => void; reject: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data: WebSocket.Data) => {
      const msg: CDPResponse = JSON.parse(data.toString());
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    });
  }

  static async connect(wsUrl: string): Promise<MainProcessCDP> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => resolve(new MainProcessCDP(ws)));
      ws.on('error', reject);
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<CDPResponse> {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * Discover the main process debugger WebSocket URL by querying /json/list
 * on the inspect port.
 */
async function getDebuggerWsUrl(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        const targets: Array<{ webSocketDebuggerUrl?: string }> = JSON.parse(data);
        const wsUrl = targets[0]?.webSocketDebuggerUrl;
        if (wsUrl) resolve(wsUrl);
        else reject(new Error('No debugger target found'));
      });
    }).on('error', reject);
  });
}

// ============================================================================
// Public API
// ============================================================================

/** State held between start and stop. */
let activeCDP: MainProcessCDP | null = null;

/**
 * Parse --inspect port from Electron's stderr output.
 * Call this AFTER electron.launch() with --inspect=0 in args.
 */
export function captureInspectPort(electronApp: ElectronApplication): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = electronApp.process();
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for --inspect port')), 10000);

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Node prints: "Debugger listening on ws://127.0.0.1:PORT/..."
      const match = text.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1], 10));
      }
    });
  });
}

export async function startMainProcessProfile(inspectPort: number): Promise<void> {
  const wsUrl = await getDebuggerWsUrl(inspectPort);
  const cdp = await MainProcessCDP.connect(wsUrl);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  activeCDP = cdp;
}

export async function stopMainProcessProfileAndSave(
  outputDir: string,
  filename: string,
): Promise<string> {
  if (!activeCDP) throw new Error('No active main process profile session');

  const response = await activeCDP.send('Profiler.stop');
  activeCDP.close();
  activeCDP = null;

  const profile = response.result?.profile;
  if (!profile) throw new Error('Profiler.stop returned no profile data');

  const profileJson = JSON.stringify(profile, null, 2);
  await fs.mkdir(outputDir, { recursive: true });
  const filepath = path.join(outputDir, filename);
  await fs.writeFile(filepath, profileJson, 'utf8');
  const sizeKB = (Buffer.byteLength(profileJson) / 1024).toFixed(0);
  console.log(`  Main process profile saved: ${filepath} (${sizeKB} KB)`);
  return filepath;
}

// ============================================================================
// .cpuprofile analysis — re-exported from the single shared implementation
// ============================================================================
//
// The .cpuprofile analyzer and its metrics type are NOT defined here: they live
// in `@vt/measures/perf/main-process-cdp` (PR #184's canonical CDP module, also
// used by the packages/measures perf harnesses). That implementation is
// byte-for-byte what used to live in this file, so re-exporting keeps a SINGLE
// analyzer implementation in the repo with no change for this module's
// consumers. This file retains only the Playwright-specific CDP *session*
// plumbing above (captureInspectPort + connect/start/stop), which the shared
// module has no equivalent for.
export {
  analyzeMainProcessProfile,
  printMainProcessMetrics,
  type MainProcessMetrics,
} from '@vt/measures/perf/main-process-cdp';
