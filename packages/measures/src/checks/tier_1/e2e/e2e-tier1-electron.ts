import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-tier1',
    name: 'E2E Tier 1 (Electron Smoke)',
    category: 'E2E',
    display: 'pnpm --filter voicetree-webapp run test:e2e:tier1:ci',
    args: () => [
        'pnpm',
        '--filter',
        'voicetree-webapp',
        'run',
        'test:e2e:tier1:ci',
    ],
    parser: 'playwright',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
