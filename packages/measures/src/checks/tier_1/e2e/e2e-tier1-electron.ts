import {type CheckDef, E2E_TIMEOUT_MS, npmRun, playwrightJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier1',
    name: 'E2E Tier 1 (Electron Smoke)',
    category: 'E2E',
    display: 'npm run test:e2e:tier1',
    args: () => npmRun('test:e2e:tier1', playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: E2E_TIMEOUT_MS,
}
