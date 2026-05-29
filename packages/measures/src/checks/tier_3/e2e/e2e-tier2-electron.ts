import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier2-electron',
    name: 'E2E Tier 2 (Electron)',
    category: 'E2E',
    display: 'pnpm --filter voicetree-webapp run test:e2e:tier2:electron:ci',
    args: () => checkArgs.npmWorkspaceRun('voicetree-webapp', 'test:e2e:tier2:electron:ci'),
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
    phase: 'isolated', // electron startup CPU spike — needs clean CPU
}
