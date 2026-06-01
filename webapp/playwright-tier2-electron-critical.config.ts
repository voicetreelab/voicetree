import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

/**
 * Tier 2 (critical) Playwright configuration for Electron.
 *
 * Narrowed to the specs we want gating every PR:
 *   - electron-editor-disk-convergence.spec.ts   (editor ↔ graph ↔ disk)
 *   - electron-project-selection.spec.ts         (launch + scanner)
 *   - electron-context-node-agent.spec.ts        (writeFolderPath resolution + vt-graphd reachability + spawnTerminalWithContextNode)
 *
 * Sibling config `playwright-electron.config.ts` runs the remaining critical
 * electron specs at tier 3 (with these `testIgnore`'d to avoid double-run).
 */
const CRITICAL_TIER2_SPECS = [
  'electron-editor-disk-convergence.spec.ts',
  'electron-project-selection.spec.ts',
  'electron-context-node-agent.spec.ts',
];

// Electron parallelism. Each spec is fully isolated (own mkdtemp project +
// `--user-data-dir`, ephemeral daemon + remote-debugging ports), and rendering
// is software-GL (SwiftShader, in-process CPU — measured: Xvfb stays <2% CPU
// even fanned out, so the shared display is NOT a bottleneck and per-worker
// displays are unnecessary). The only cost of fanning out is CPU + RAM, so we
// only do it on big hosts (the 64c/188GB devbox) and keep CI's 4-core runners
// serial — preserving today's behaviour there exactly. `fullyParallel: false`
// means parallelism is per-file, so the spec-file count is the natural ceiling.
// Override with VT_E2E_ELECTRON_WORKERS. Measured devbox: 1 worker 155s -> 3 workers 88s.
const BIG_HOST_CORE_THRESHOLD = 32;

function resolveElectronWorkers(): number {
  const override = Number(process.env.VT_E2E_ELECTRON_WORKERS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return availableParallelism() >= BIG_HOST_CORE_THRESHOLD ? CRITICAL_TIER2_SPECS.length : 1;
}

export default defineConfig({
  testDir: './e2e-tests/electron/critical_e2e_verification_tests',
  testMatch: CRITICAL_TIER2_SPECS,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: resolveElectronWorkers(),
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }],
    ['html', { outputFolder: 'playwright-report-tier2-electron-critical', open: 'never' }],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-tier2-electron-critical',
      checkName: 'E2E Tier 2 (Electron Critical)',
      command: 'npm run test:e2e:tier2:electron-critical',
    }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: process.env.CI ? 90000 : 30000,
  projects: [
    {
      name: 'electron',
      testMatch: CRITICAL_TIER2_SPECS,
    },
  ],
});
