import {type CheckDef, E2E_TIMEOUT_MS, npmRun, playwrightJsonArgs} from './_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-electron',
    name: 'E2E Tier 2 (Electron)',
    category: 'E2E',
    display: 'npm run test:e2e:tier2:electron',
    args: () => npmRun('test:e2e:tier2:electron', playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: E2E_TIMEOUT_MS,
}
