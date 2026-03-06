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
// Analysis — parse .cpuprofile and print top functions
// ============================================================================

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface MainProcessMetrics {
  totalDurationMs: number;
  totalSamples: number;
  topFunctions: Array<{
    name: string;
    url: string;
    line: number;
    selfSamples: number;
    selfPercent: number;
  }>;
}

export function analyzeMainProcessProfile(profileJson: string): MainProcessMetrics {
  const profile: CpuProfile = JSON.parse(profileJson);
  const totalDurationMs = (profile.endTime - profile.startTime) / 1000;
  const totalSamples = profile.samples.length;

  const nodeMap = new Map<number, CpuProfileNode>();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  const sampleCounts = new Map<number, number>();
  for (const sampleId of profile.samples) {
    sampleCounts.set(sampleId, (sampleCounts.get(sampleId) ?? 0) + 1);
  }

  const funcKey = (n: CpuProfileNode): string =>
    `${n.callFrame.functionName}|${n.callFrame.url}|${n.callFrame.lineNumber}`;

  const funcSamples = new Map<string, { node: CpuProfileNode; count: number }>();
  for (const [nodeId, count] of Array.from(sampleCounts.entries())) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const fn = node.callFrame.functionName;
    if (fn === '(idle)' || fn === '(program)' || fn === '(garbage collector)') continue;

    const key = funcKey(node);
    const existing = funcSamples.get(key);
    if (existing) {
      existing.count += count;
    } else {
      funcSamples.set(key, { node, count });
    }
  }

  const sorted = Array.from(funcSamples.values())
    .sort((a, b) => b.count - a.count);

  const activeSamples = sorted.reduce((sum, e) => sum + e.count, 0);

  const topFunctions = sorted.slice(0, 50).map((entry) => ({
    name: entry.node.callFrame.functionName || '(anonymous)',
    url: entry.node.callFrame.url,
    line: entry.node.callFrame.lineNumber,
    selfSamples: entry.count,
    selfPercent: activeSamples > 0 ? (entry.count / activeSamples) * 100 : 0,
  }));

  return { totalDurationMs, totalSamples, topFunctions };
}

export function printMainProcessMetrics(metrics: MainProcessMetrics): void {
  const divider = '='.repeat(90);
  console.log(`\n${divider}`);
  console.log('  MAIN PROCESS CPU PROFILE');
  console.log(`  Duration: ${(metrics.totalDurationMs / 1000).toFixed(2)}s | Samples: ${metrics.totalSamples}`);
  console.log(divider);
  console.log(
    'Samples'.padStart(10) +
    '%Self'.padStart(8) +
    '  ' + 'Function'.padEnd(40) +
    '  Source'
  );
  console.log('-'.repeat(90));

  for (const fn of metrics.topFunctions) {
    const url = fn.url;
    const shortUrl = url.includes('/')
      ? url.split('/').slice(-3).join('/')
      : url;
    const source = shortUrl ? `${shortUrl}:${fn.line}` : '(native)';
    const isAppCode = url && !url.includes('node_modules') && !url.startsWith('node:');

    console.log(
      String(fn.selfSamples).padStart(10) +
      (fn.selfPercent.toFixed(1) + '%').padStart(8) +
      '  ' + (isAppCode ? '>>> ' : '    ') + fn.name.substring(0, 36).padEnd(36) +
      '  ' + source.substring(0, 50)
    );
  }
  console.log(divider);
}
