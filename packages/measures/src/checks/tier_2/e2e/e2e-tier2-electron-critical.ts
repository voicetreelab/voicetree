import {type CheckDef, E2E_TIMEOUT_MS, npmRun, playwrightJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-electron-critical',
    name: 'E2E Tier 2 (Electron Critical)',
    category: 'E2E',
    display: 'npm run test:e2e:tier2:electron-critical',
    args: () => npmRun('test:e2e:tier2:electron-critical', playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: E2E_TIMEOUT_MS,
    phase: 'isolated', // electron startup CPU spike — needs clean CPU
}
