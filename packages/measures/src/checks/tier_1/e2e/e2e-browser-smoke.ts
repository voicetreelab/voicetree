import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-browser-smoke',
    name: 'E2E Browser Smoke',
    category: 'E2E',
    display: 'npm --workspace webapp exec -- playwright test --config=playwright-ci-smoke.config.ts',
    args: () => checkArgs.npmWorkspaceExec('webapp', 'playwright', 'test', '--config=playwright-ci-smoke.config.ts', ...checkArgs.playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
    // Vite server + Chromium workers should not compete for file descriptors
    // in the tier-1 pool.
    phase: 'isolated',
}
