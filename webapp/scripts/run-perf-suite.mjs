#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WEBAPP_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DEFAULT_NODE_COUNT = '500';
const DEFAULT_TOPOLOGY = 'clustered';
const DEFAULT_INSPECT_PORT = 9230;

const SCENARIOS = [
  {
    name: 'cdp-synthetic',
    spec: 'e2e-tests/electron/for_feature_development_not_LT_verification/graph/electron-500-node-cdp-perf.spec.ts',
    topology: 'clustered',
  },
  {
    name: 'realistic-project',
    spec: 'e2e-tests/electron/for_feature_development_not_LT_verification/graph/electron-500-node-realistic-perf.spec.ts',
    topology: 'realistic',
  },
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    help: false,
    nodeCount: process.env.PERF_NODE_COUNT || DEFAULT_NODE_COUNT,
    topology: process.env.PERF_TOPOLOGY || '',
    outputDir: process.env.PERF_OUTPUT_DIR || '',
    inspectPort: Number(process.env.PERF_INSPECT_PORT || DEFAULT_INSPECT_PORT),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--node-count') args.nodeCount = argv[++index];
    else if (arg === '--topology') args.topology = argv[++index];
    else if (arg === '--output-dir') args.outputDir = argv[++index];
    else if (arg === '--inspect-port') args.inspectPort = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.inspectPort) || args.inspectPort < 1) {
    throw new Error(`Invalid inspect port: ${args.inspectPort}`);
  }

  return args;
}

function usage() {
  return `Usage: npm run test:perf:v1 -- [options]

Runs the V1 Electron performance suite serially and writes run artifacts.

Options:
  --dry-run              Print planned commands and write summary/report without executing
  --node-count <count>   PERF_NODE_COUNT for scenarios (default: ${DEFAULT_NODE_COUNT})
  --topology <name>      PERF_TOPOLOGY override for every scenario
  --output-dir <path>    PERF_OUTPUT_DIR suite folder (default: e2e-tests/perf-runs/<timestamp>)
  --inspect-port <port>  First scenario inspect port (default: ${DEFAULT_INSPECT_PORT})
  --help, -h             Show this help
`;
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(command, args, {
      cwd: WEBAPP_ROOT,
      env: options.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      stderr += `${error.stack || error.message}\n`;
    });
    child.on('close', (code, signal) => {
      const finishedAt = new Date();
      resolve({
        command,
        args,
        code,
        signal,
        stdout,
        stderr,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
    });
  });
}

function commandLine(command, args) {
  return [command, ...args].join(' ');
}

async function writeScenarioArtifacts(scenarioDir, result) {
  await writeFile(path.join(scenarioDir, 'stdout.log'), result.stdout || '', 'utf8');
  await writeFile(path.join(scenarioDir, 'stderr.log'), result.stderr || '', 'utf8');
  await writeFile(path.join(scenarioDir, 'status.json'), JSON.stringify(result, null, 2), 'utf8');
}

function scenarioEnv(args, scenario, index, scenarioDir) {
  return {
    ...process.env,
    PERF_NODE_COUNT: String(args.nodeCount),
    PERF_TOPOLOGY: args.topology || scenario.topology,
    PERF_OUTPUT_DIR: scenarioDir,
    PERF_INSPECT_PORT: String(args.inspectPort + index),
    PLAYWRIGHT_QUIET: process.env.PLAYWRIGHT_QUIET || 'false',
  };
}

function scenarioCommand(scenario) {
  return {
    command: 'npx',
    args: [
      'playwright',
      'test',
      '--config=playwright-electron-dev.config.ts',
      scenario.spec,
      '--reporter=list',
    ],
  };
}

function toSummary({ args, runDir, buildResult, scenarioResults, startedAt, finishedAt }) {
  const failedScenarios = scenarioResults.filter((scenario) => scenario.status !== 'passed');
  const status = args.dryRun
    ? 'skipped'
    : buildResult.status === 'passed' && failedScenarios.length === 0
      ? 'passed'
      : 'failed';

  return {
    suite: 'perf-v1',
    status,
    dryRun: args.dryRun,
    runDir,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    envContract: {
      PERF_NODE_COUNT: String(args.nodeCount),
      PERF_TOPOLOGY: args.topology || '<scenario default>',
      PERF_OUTPUT_DIR: '<scenario output directory>',
      PERF_INSPECT_PORT: '<base inspect port + scenario index>',
    },
    build: buildResult,
    scenarios: scenarioResults,
  };
}

function toMarkdownReport(summary) {
  const rows = summary.scenarios
    .map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.durationMs} | ${scenario.inspectPort} | \`${scenario.relativeDir}\` |`)
    .join('\n');

  return `# Performance V1 Run

- Status: ${summary.status}
- Dry run: ${summary.dryRun}
- Started: ${summary.startedAt}
- Finished: ${summary.finishedAt}
- Duration: ${summary.durationMs} ms
- Run directory: \`${summary.runDir}\`

## Environment Contract

- PERF_NODE_COUNT: \`${summary.envContract.PERF_NODE_COUNT}\`
- PERF_TOPOLOGY: \`${summary.envContract.PERF_TOPOLOGY}\`
- PERF_OUTPUT_DIR: \`${summary.envContract.PERF_OUTPUT_DIR}\`
- PERF_INSPECT_PORT: \`${summary.envContract.PERF_INSPECT_PORT}\`

## Build

- Status: ${summary.build.status}
- Duration: ${summary.build.durationMs} ms
- Command: \`${summary.build.commandLine}\`

## Scenarios

| Scenario | Status | Duration ms | Inspect port | Artifacts |
| --- | --- | ---: | ---: | --- |
${rows}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const startedAt = new Date().toISOString();
  const runDir = path.resolve(WEBAPP_ROOT, args.outputDir || path.join('e2e-tests', 'perf-runs', timestampForPath()));
  await mkdir(runDir, { recursive: true });

  const buildCommand = { command: 'npm', args: ['run', 'electron:build'] };
  const buildResult = args.dryRun
    ? {
        status: 'skipped',
        commandLine: commandLine(buildCommand.command, buildCommand.args),
        durationMs: 0,
        code: 0,
        signal: null,
      }
    : await runCommand(buildCommand.command, buildCommand.args, { env: process.env });

  if (!args.dryRun) {
    buildResult.status = buildResult.code === 0 ? 'passed' : 'failed';
    buildResult.commandLine = commandLine(buildCommand.command, buildCommand.args);
  }

  const scenarioResults = [];
  if (buildResult.status === 'passed' || args.dryRun) {
    for (const [index, scenario] of SCENARIOS.entries()) {
      const scenarioDir = path.join(runDir, `${index + 1}-${scenario.name}`);
      await mkdir(scenarioDir, { recursive: true });
      const env = scenarioEnv(args, scenario, index, scenarioDir);
      const { command, args: commandArgs } = scenarioCommand(scenario);
      const planned = {
        name: scenario.name,
        spec: scenario.spec,
        relativeDir: path.relative(WEBAPP_ROOT, scenarioDir),
        inspectPort: Number(env.PERF_INSPECT_PORT),
        topology: env.PERF_TOPOLOGY,
        nodeCount: env.PERF_NODE_COUNT,
        commandLine: commandLine(command, commandArgs),
      };

      const result = args.dryRun
        ? { ...planned, status: 'skipped', durationMs: 0, code: 0, signal: null, stdout: '', stderr: '' }
        : { ...planned, ...(await runCommand(command, commandArgs, { env })) };

      result.status = result.code === 0 ? (args.dryRun ? 'skipped' : 'passed') : 'failed';
      await writeScenarioArtifacts(scenarioDir, result);
      scenarioResults.push(result);
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = toSummary({ args, runDir, buildResult, scenarioResults, startedAt, finishedAt });
  await writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(runDir, 'report.md'), toMarkdownReport(summary), 'utf8');

  process.stdout.write(`\n[perf-v1] ${summary.status}: ${runDir}\n`);
  process.exitCode = summary.status === 'passed' || args.dryRun ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
