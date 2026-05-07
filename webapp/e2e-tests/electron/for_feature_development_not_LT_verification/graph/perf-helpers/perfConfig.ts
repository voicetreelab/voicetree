import * as path from 'path';

export interface PerfTestConfig {
  nodeCount: number;
  clusterCount: number;
  nodesPerCluster: number;
  updateNodeCount: number;
  updateNodesPerCluster: number;
  clusterSpacing: number;
  outputDir: string;
  inspectPort: number;
  topology: string;
  isSmoke: boolean;
}

const DEFAULT_NODE_COUNT = 500;
const DEFAULT_CLUSTER_COUNT = 10;
const DEFAULT_CLUSTER_SPACING = 50000;
const DEFAULT_INSPECT_PORT = 9230;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  console.warn(`[Perf Config] Ignoring ${name}=${raw}; expected a positive integer`);
  return fallback;
}

function readBoolean(name: string): boolean {
  const raw = process.env[name]?.toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function chooseClusterCount(nodeCount: number): number {
  if (nodeCount <= DEFAULT_CLUSTER_COUNT) return nodeCount;
  if (nodeCount % DEFAULT_CLUSTER_COUNT === 0) return DEFAULT_CLUSTER_COUNT;

  for (let candidate = DEFAULT_CLUSTER_COUNT; candidate >= 2; candidate--) {
    if (nodeCount % candidate === 0) return candidate;
  }

  return 1;
}

export function loadPerfTestConfig(projectRoot: string): PerfTestConfig {
  const isSmoke = readBoolean('PERF_SMOKE');
  const defaultNodeCount = isSmoke ? 50 : DEFAULT_NODE_COUNT;
  const nodeCount = readPositiveInt('PERF_NODE_COUNT', defaultNodeCount);
  const clusterCount = readPositiveInt('PERF_CLUSTER_COUNT', chooseClusterCount(nodeCount));
  const nodesPerCluster = Math.max(1, Math.ceil(nodeCount / clusterCount));
  const generatedNodeCount = clusterCount * nodesPerCluster;
  const updateNodeCount = readPositiveInt(
    'PERF_UPDATE_NODE_COUNT',
    Math.max(clusterCount, Math.round(generatedNodeCount * 0.1))
  );
  const updateNodesPerCluster = Math.max(1, Math.ceil(updateNodeCount / clusterCount));
  const outputDir = process.env.PERF_OUTPUT_DIR
    ? path.resolve(projectRoot, process.env.PERF_OUTPUT_DIR)
    : path.join(projectRoot, 'e2e-tests', 'perf-traces');

  return {
    nodeCount: generatedNodeCount,
    clusterCount,
    nodesPerCluster,
    updateNodeCount: clusterCount * updateNodesPerCluster,
    updateNodesPerCluster,
    clusterSpacing: readPositiveInt('PERF_CLUSTER_SPACING', DEFAULT_CLUSTER_SPACING),
    outputDir,
    inspectPort: readPositiveInt('PERF_INSPECT_PORT', DEFAULT_INSPECT_PORT),
    topology: process.env.PERF_TOPOLOGY ?? 'binary-tree-clusters',
    isSmoke,
  };
}

export function describePerfTestConfig(config: PerfTestConfig): string {
  return [
    `nodes=${config.nodeCount}`,
    `clusters=${config.clusterCount}`,
    `nodesPerCluster=${config.nodesPerCluster}`,
    `updateNodes=${config.updateNodeCount}`,
    `topology=${config.topology}`,
    `outputDir=${config.outputDir}`,
    `inspectPort=${config.inspectPort}`,
    `smoke=${config.isSmoke}`,
  ].join(', ');
}
