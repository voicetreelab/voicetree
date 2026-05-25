import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-electron-critical',
    name: 'E2E Tier 2 (Electron Critical)',
    category: 'E2E',
    display: 'npm run test:e2e:tier2:electron-critical',
    args: () => checkArgs.npmRun('test:e2e:tier2:electron-critical', checkArgs.playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
    phase: 'isolated', // electron startup CPU spike — needs clean CPU
}
