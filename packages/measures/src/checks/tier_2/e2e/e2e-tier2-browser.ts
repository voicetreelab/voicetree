import {type CheckDef, E2E_TIMEOUT_MS, npmRun, playwrightJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-browser',
    name: 'E2E Tier 2 (Browser)',
    category: 'E2E',
    display: 'npm run test:e2e:tier2:browser',
    args: () => npmRun('test:e2e:tier2:browser', playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: E2E_TIMEOUT_MS,
    phase: 'isolated', // vite dev server + 5 chromium workers — needs clean CPU
}
