import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier1',
    name: 'E2E Tier 1 (Electron Smoke)',
    category: 'E2E',
    display: 'npm run test:e2e:tier1',
    args: () => checkArgs.npmRun('test:e2e:tier1', checkArgs.playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
