/**
 * File-level metric extraction for perf runner/report consumers.
 *
 * Existing helpers analyze in-memory CDP traces and CPU profiles while specs run.
 * This module keeps the same metric shapes but reads saved artifacts from disk,
 * so runner/report code can summarize a completed perf output directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { analyzeTrace, type PhaseMetrics, type TraceData } from './cdpTrace';
import { analyzeMainProcessProfile, type MainProcessMetrics } from './mainProcessProfile';

export type PerfArtifactKind = 'trace' | 'cpuprofile';

export interface TraceMetricArtifact {
  kind: 'trace';
  path: string;
  fileName: string;
  fileSizeBytes: number;
  phaseName: string;
  metrics: PhaseMetrics;
}

export interface CpuProfileMetricArtifact {
  kind: 'cpuprofile';
  path: string;
  fileName: string;
  fileSizeBytes: number;
  phaseName: string;
  metrics: MainProcessMetrics;
}

export type PerfMetricArtifact = TraceMetricArtifact | CpuProfileMetricArtifact;

export interface ExtractPerfMetricsOptions {
  phaseNamesByFile?: Record<string, string>;
}

export async function readTraceData(tracePath: string): Promise<TraceData> {
  const traceJson = await fs.readFile(tracePath, 'utf8');
  return parseTraceData(traceJson);
}

export async function extractTraceMetricsFromFile(
  tracePath: string,
  phaseName = inferPhaseNameFromFile(tracePath),
): Promise<TraceMetricArtifact> {
  const [traceData, stats] = await Promise.all([
    readTraceData(tracePath),
    fs.stat(tracePath),
  ]);
  return {
    kind: 'trace',
    path: tracePath,
    fileName: path.basename(tracePath),
    fileSizeBytes: stats.size,
    phaseName,
    metrics: analyzeTrace(traceData, phaseName),
  };
}

export async function readCpuProfileJson(profilePath: string): Promise<string> {
  return fs.readFile(profilePath, 'utf8');
}

export async function extractCpuProfileMetricsFromFile(
  profilePath: string,
  phaseName = inferPhaseNameFromFile(profilePath),
): Promise<CpuProfileMetricArtifact> {
  const [profileJson, stats] = await Promise.all([
    readCpuProfileJson(profilePath),
    fs.stat(profilePath),
  ]);
  return {
    kind: 'cpuprofile',
    path: profilePath,
    fileName: path.basename(profilePath),
    fileSizeBytes: stats.size,
    phaseName,
    metrics: analyzeMainProcessProfile(profileJson),
  };
}

export async function extractPerfMetricsFromDirectory(
  outputDir: string,
  options: ExtractPerfMetricsOptions = {},
): Promise<PerfMetricArtifact[]> {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const artifactPaths = entries
    .filter((entry) => entry.isFile() && isSupportedPerfArtifact(entry.name))
    .map((entry) => path.join(outputDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  const artifacts: PerfMetricArtifact[] = [];
  for (const artifactPath of artifactPaths) {
    const phaseName = options.phaseNamesByFile?.[path.basename(artifactPath)]
      ?? inferPhaseNameFromFile(artifactPath);
    if (artifactPath.endsWith('.json')) {
      artifacts.push(await extractTraceMetricsFromFile(artifactPath, phaseName));
    } else {
      artifacts.push(await extractCpuProfileMetricsFromFile(artifactPath, phaseName));
    }
  }
  return artifacts;
}

export function summarizePerfMetricArtifacts(artifacts: PerfMetricArtifact[]): Record<string, unknown> {
  return {
    traces: artifacts
      .filter((artifact): artifact is TraceMetricArtifact => artifact.kind === 'trace')
      .map((artifact) => ({
        file: artifact.path,
        fileName: artifact.fileName,
        fileSizeBytes: artifact.fileSizeBytes,
        phaseName: artifact.phaseName,
        totalDurationMs: artifact.metrics.totalDurationMs,
        jsExecutionMs: artifact.metrics.jsExecutionMs,
        layoutMs: artifact.metrics.layoutMs,
        paintMs: artifact.metrics.paintMs,
        gcMs: artifact.metrics.gcMs,
        longestTaskMs: artifact.metrics.longestTaskMs,
        gpu: artifact.metrics.gpu,
        topFunctions: artifact.metrics.topFunctions,
        userTimingMarks: artifact.metrics.userTimingMarks,
      })),
    cpuProfiles: artifacts
      .filter((artifact): artifact is CpuProfileMetricArtifact => artifact.kind === 'cpuprofile')
      .map((artifact) => ({
        file: artifact.path,
        fileName: artifact.fileName,
        fileSizeBytes: artifact.fileSizeBytes,
        phaseName: artifact.phaseName,
        totalDurationMs: artifact.metrics.totalDurationMs,
        totalSamples: artifact.metrics.totalSamples,
        topFunctions: artifact.metrics.topFunctions,
      })),
  };
}

function parseTraceData(traceJson: string): TraceData {
  const parsed = JSON.parse(traceJson) as TraceData | TraceData['traceEvents'];
  return Array.isArray(parsed) ? { traceEvents: parsed } : parsed;
}

function isSupportedPerfArtifact(filename: string): boolean {
  return filename.endsWith('.json') || filename.endsWith('.cpuprofile');
}

function inferPhaseNameFromFile(filePath: string): string {
  const basename = path.basename(filePath).replace(/\.(json|cpuprofile)$/u, '');
  return basename
    .replace(/-\d{4}-\d{2}-\d{2}T.*$/u, '')
    .replace(/-\d{13,}$/u, '')
    .replace(/-/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toUpperCase();
}
