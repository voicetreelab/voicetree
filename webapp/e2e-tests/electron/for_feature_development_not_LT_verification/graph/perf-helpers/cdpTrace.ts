/**
 * CDP (Chrome DevTools Protocol) trace capture and analysis.
 *
 * - startCDPTrace / stopCDPTraceAndSave: side-effectful CDP I/O
 * - analyzeTrace: pure function, extracts metrics from Chrome Trace Event Format
 * - printMetricsTable: pure console output formatting
 */

import type { CDPSession } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface TraceEvent {
  name: string;
  cat: string;
  ph: string;  // 'B'=begin, 'E'=end, 'X'=complete, 'I'=instant, 'R'=mark
  ts: number;  // microseconds
  dur?: number; // microseconds (for 'X' complete events)
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export interface TraceData {
  traceEvents: TraceEvent[];
  metadata?: Record<string, unknown>;
}

export interface GpuMetrics {
  frameCount: number;
  estimatedFps: number;
  rasterTotalMs: number;
  rasterCount: number;
  compositorFrameTotalMs: number;
  compositorFrameCount: number;
  longestCompositorFrameMs: number;
  layerCount: number | null;
}

export interface PhaseMetrics {
  phaseName: string;
  totalDurationMs: number;
  jsExecutionMs: number;
  layoutMs: number;
  paintMs: number;
  gcMs: number;
  longestTaskMs: number;
  topFunctions: Array<{ name: string; totalMs: number }>;
  userTimingMarks: string[];
  gpu: GpuMetrics;
}

// ============================================================================
// CDP trace capture (side-effectful)
// ============================================================================

const CDP_BASELINE_CATEGORY_PARTS: string[] = [
  'devtools.timeline',
  'v8',
  'v8.execute',
  'blink.user_timing',
  'disabled-by-default-devtools.timeline',
];

const CDP_PAN_ZOOM_EXTRA_CATEGORY_PARTS: string[] = [
  'gpu',
  'viz',
  'cc',
  'disabled-by-default-gpu.service',
  'disabled-by-default-cc',
  'disabled-by-default-cc.debug',
  'disabled-by-default-gpu.device',
  'compositor',
  'benchmark',
];

// Renderer CPU sampling comes from the Profiler domain, so traces stay lighter
// and avoid duplicate v8.cpu_profiler events.
export const CDP_BASELINE_CATEGORIES = CDP_BASELINE_CATEGORY_PARTS.join(',');
export const CDP_PAN_ZOOM_CATEGORIES = [
  ...CDP_BASELINE_CATEGORY_PARTS,
  ...CDP_PAN_ZOOM_EXTRA_CATEGORY_PARTS,
].join(',');

export async function startCDPTrace(
  cdp: CDPSession,
  categories: string = CDP_BASELINE_CATEGORIES
): Promise<void> {
  await cdp.send('Tracing.start', {
    categories,
    transferMode: 'ReturnAsStream',
  });
}

export async function stopCDPTraceAndSave(
  cdp: CDPSession,
  outputDir: string,
  filename: string
): Promise<TraceData> {
  const traceCompletePromise = new Promise<string>((resolve) => {
    cdp.on('Tracing.tracingComplete', (params: { stream?: string }) => {
      resolve(params.stream ?? '');
    });
  });

  await cdp.send('Tracing.end');
  const streamHandle = await traceCompletePromise;

  // Read the trace stream chunk by chunk
  let traceJson = '';
  if (streamHandle) {
    let eof = false;
    while (!eof) {
      const result = await cdp.send('IO.read', { handle: streamHandle });
      traceJson += result.data;
      eof = result.eof;
    }
    await cdp.send('IO.close', { handle: streamHandle });
  }

  // Parse — traces can be a root object or a bare array
  let traceData: TraceData;
  try {
    traceData = JSON.parse(traceJson) as TraceData;
  } catch {
    traceData = { traceEvents: JSON.parse(traceJson) as TraceEvent[] };
  }

  await fs.mkdir(outputDir, { recursive: true });
  const filepath = path.join(outputDir, filename);
  await fs.writeFile(filepath, JSON.stringify(traceData, null, 2));
  console.log(`  Trace saved: ${filepath} (${(traceJson.length / 1024).toFixed(0)} KB)`);

  return traceData;
}

// ============================================================================
// Trace analysis (pure)
// ============================================================================

export function analyzeTrace(traceData: TraceData, phaseName: string): PhaseMetrics {
  const events = traceData.traceEvents;
  if (!events || events.length === 0) {
    return emptyMetrics(phaseName);
  }

  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const e of events) {
    if (e.ts > 0) {
      if (e.ts < minTs) minTs = e.ts;
      if (e.ts > maxTs) maxTs = e.ts;
    }
  }
  const totalDurationMs = maxTs > minTs ? (maxTs - minTs) / 1000 : 0;

  let jsExecutionUs = 0;
  let layoutUs = 0;
  let paintUs = 0;
  let gcUs = 0;
  let longestTaskUs = 0;
  const functionTimes = new Map<string, number>();
  const userTimingMarks: string[] = [];

  // GPU / compositor accumulators
  let beginFrameCount = 0;
  let rasterTotalUs = 0;
  let rasterCount = 0;
  let compositorFrameTotalUs = 0;
  let compositorFrameCount = 0;
  let longestCompositorFrameUs = 0;
  let layerCount: number | null = null;

  for (const event of events) {
    const dur = event.dur ?? 0;

    if (event.name === 'EvaluateScript' || event.name === 'FunctionCall') {
      jsExecutionUs += dur;
    }
    if (event.name === 'Layout') {
      layoutUs += dur;
    }
    if (event.name === 'Paint' || event.name === 'PaintImage' || event.name === 'CompositeLayers') {
      paintUs += dur;
    }
    if (event.name === 'MajorGC' || event.name === 'MinorGC') {
      gcUs += dur;
    }
    if (dur > longestTaskUs && (event.ph === 'X' || event.ph === 'B')) {
      longestTaskUs = dur;
    }
    if (event.ph === 'X' && dur > 0 && event.name && event.name !== 'Program') {
      functionTimes.set(event.name, (functionTimes.get(event.name) ?? 0) + dur);
    }
    if (event.cat === 'blink.user_timing' && (event.ph === 'R' || event.ph === 'I')) {
      userTimingMarks.push(event.name);
    }

    // GPU / compositor events
    if (matchesTraceEventName(event.name, 'BeginFrame')) {
      beginFrameCount++;
    }
    if (matchesTraceEventName(event.name, 'RasterTask') && dur > 0) {
      rasterTotalUs += dur;
      rasterCount++;
    }
    if (matchesTraceEventName(event.name, 'DrawFrame', 'DrawAndSwap') && dur > 0) {
      compositorFrameTotalUs += dur;
      compositorFrameCount++;
      if (dur > longestCompositorFrameUs) longestCompositorFrameUs = dur;
    }
    if (matchesTraceEventName(event.name, 'CalculateRenderPasses')) {
      const count = event.args?.['layerCount'] as number | undefined
        ?? event.args?.['layer_count'] as number | undefined;
      if (count != null) layerCount = count;
    }
  }

  const topFunctions = Array.from(functionTimes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, totalUs]) => ({ name, totalMs: totalUs / 1000 }));

  const durationSec = totalDurationMs / 1000;
  const estimatedFps = durationSec > 0 ? beginFrameCount / durationSec : 0;

  return {
    phaseName,
    totalDurationMs,
    jsExecutionMs: jsExecutionUs / 1000,
    layoutMs: layoutUs / 1000,
    paintMs: paintUs / 1000,
    gcMs: gcUs / 1000,
    longestTaskMs: longestTaskUs / 1000,
    topFunctions,
    userTimingMarks: Array.from(new Set(userTimingMarks)),
    gpu: {
      frameCount: beginFrameCount,
      estimatedFps,
      rasterTotalMs: rasterTotalUs / 1000,
      rasterCount,
      compositorFrameTotalMs: compositorFrameTotalUs / 1000,
      compositorFrameCount,
      longestCompositorFrameMs: longestCompositorFrameUs / 1000,
      layerCount,
    },
  };
}

function emptyMetrics(phaseName: string): PhaseMetrics {
  return {
    phaseName,
    totalDurationMs: 0,
    jsExecutionMs: 0,
    layoutMs: 0,
    paintMs: 0,
    gcMs: 0,
    longestTaskMs: 0,
    topFunctions: [],
    userTimingMarks: [],
    gpu: {
      frameCount: 0,
      estimatedFps: 0,
      rasterTotalMs: 0,
      rasterCount: 0,
      compositorFrameTotalMs: 0,
      compositorFrameCount: 0,
      longestCompositorFrameMs: 0,
      layerCount: null,
    },
  };
}

// ============================================================================
// ASCII table output (pure formatting)
// ============================================================================

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

export function printMetricsTable(metrics: PhaseMetrics): void {
  const divider = '─'.repeat(60);
  console.log('');
  console.log(`┌${divider}┐`);
  console.log(`│ PHASE: ${metrics.phaseName.padEnd(50)} │`);
  console.log(`├${divider}┤`);
  console.log(`│ Total duration:     ${fmtMs(metrics.totalDurationMs).padEnd(38)} │`);
  console.log(`│ JS execution:       ${fmtMs(metrics.jsExecutionMs).padEnd(38)} │`);
  console.log(`│ Blink Layout:       ${fmtMs(metrics.layoutMs).padEnd(38)} │`);
  console.log(`│ Blink Paint:        ${fmtMs(metrics.paintMs).padEnd(38)} │`);
  console.log(`│ GC (Major+Minor):   ${fmtMs(metrics.gcMs).padEnd(38)} │`);
  console.log(`│ Longest task:       ${fmtMs(metrics.longestTaskMs).padEnd(38)} │`);
  console.log(`├${divider}┤`);
  console.log(`│ Top 5 hotspots:${' '.repeat(43)} │`);
  for (const fn of metrics.topFunctions) {
    const line = `  ${fn.name.slice(0, 40).padEnd(40)} ${fmtMs(fn.totalMs)}`;
    console.log(`│ ${line.padEnd(58)} │`);
  }
  if (metrics.userTimingMarks.length > 0) {
    console.log(`├${divider}┤`);
    console.log(`│ User timing marks:${' '.repeat(40)} │`);
    for (const mark of metrics.userTimingMarks) {
      console.log(`│   ${mark.slice(0, 55).padEnd(56)} │`);
    }
  }
  const g = metrics.gpu;
  const hasGpuData = g.frameCount > 0 || g.rasterCount > 0 || g.compositorFrameCount > 0;
  console.log(`├${divider}┤`);
  console.log(`│ GPU / Compositor:${' '.repeat(41)} │`);
  if (hasGpuData) {
    console.log(`│ Frames (BeginFrame):${`${g.frameCount} (~${g.estimatedFps.toFixed(1)} fps)`.padEnd(38)} │`);
    console.log(`│ Raster tasks:       ${`${g.rasterCount} totalling ${fmtMs(g.rasterTotalMs)}`.padEnd(38)} │`);
    console.log(`│ Compositor draws:   ${`${g.compositorFrameCount} totalling ${fmtMs(g.compositorFrameTotalMs)}`.padEnd(38)} │`);
    console.log(`│ Longest comp frame: ${fmtMs(g.longestCompositorFrameMs).padEnd(38)} │`);
    console.log(`│ Layer count:        ${(g.layerCount != null ? String(g.layerCount) : 'n/a').padEnd(38)} │`);
  } else {
    console.log(`│ (no GPU trace events captured)${' '.repeat(28)} │`);
  }
  console.log(`└${divider}┘`);
  console.log('');
}

function matchesTraceEventName(eventName: string, ...suffixes: string[]): boolean {
  return suffixes.some((suffix) => eventName === suffix || eventName.endsWith(`::${suffix}`));
}
