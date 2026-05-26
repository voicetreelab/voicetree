import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-electron',
    name: 'E2E Tier 2 (Electron)',
    category: 'E2E',
    display: 'npm run test:e2e:tier2:electron',
    args: () => checkArgs.npmRun('test:e2e:tier2:electron', checkArgs.playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
    phase: 'isolated', // electron startup CPU spike — needs clean CPU
}
