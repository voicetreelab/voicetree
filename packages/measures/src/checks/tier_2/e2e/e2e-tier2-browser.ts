import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-browser',
    name: 'E2E Tier 2 (Browser)',
    category: 'E2E',
    display: 'pnpm --filter voicetree-webapp run test:e2e:tier2:browser:ci',
    args: () => checkArgs.npmWorkspaceRun('voicetree-webapp', 'test:e2e:tier2:browser:ci'),
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
    phase: 'isolated', // vite dev server + 5 chromium workers — needs clean CPU
}
