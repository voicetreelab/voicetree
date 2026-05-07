import * as fs from 'fs/promises';
import * as path from 'path';

import { analyzeTrace } from './cdpTrace';
import type { PhaseMetrics, TraceData, TraceEvent } from './cdpTrace';
import { analyzeMainProcessProfile } from './mainProcessProfile';
import type { MainProcessMetrics } from './mainProcessProfile';

export interface PerfArtifactMetrics {
  file: string;
  kind: 'trace' | 'cpuprofile';
  label: string;
  metrics: PhaseMetrics | MainProcessMetrics;
}

export async function analyzeTraceFile(filePath: string, phaseName = path.basename(filePath)): Promise<PhaseMetrics> {
  const raw = await fs.readFile(filePath, 'utf8');
  return analyzeTrace(parseTraceData(raw), phaseName);
}

export async function analyzeCpuProfileFile(filePath: string): Promise<MainProcessMetrics> {
  const raw = await fs.readFile(filePath, 'utf8');
  return analyzeMainProcessProfile(raw);
}

export async function analyzePerfArtifact(filePath: string): Promise<PerfArtifactMetrics> {
  const label = path.basename(filePath);
  if (filePath.endsWith('.json')) {
    return {
      file: filePath,
      kind: 'trace',
      label,
      metrics: await analyzeTraceFile(filePath, label),
    };
  }

  if (filePath.endsWith('.cpuprofile')) {
    return {
      file: filePath,
      kind: 'cpuprofile',
      label,
      metrics: await analyzeCpuProfileFile(filePath),
    };
  }

  throw new Error(`Unsupported perf artifact extension: ${filePath}`);
}

export async function analyzePerfArtifacts(filePaths: string[]): Promise<PerfArtifactMetrics[]> {
  const metrics: PerfArtifactMetrics[] = [];
  for (const filePath of filePaths) {
    metrics.push(await analyzePerfArtifact(filePath));
  }
  return metrics;
}

function parseTraceData(raw: string): TraceData {
  const parsed = JSON.parse(raw) as TraceData | TraceEvent[];
  if (Array.isArray(parsed)) {
    return { traceEvents: parsed };
  }
  return parsed;
}
