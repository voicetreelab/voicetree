import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'webapp-lint',
    // tier_2: 2026-05-25 — typescript-eslint type-aware lint on the webapp at ~58s (Onidel) exceeds tier_1 individual <30s budget even after collapsing 7 chained invocations into 1 (a0215b72).
    name: 'Webapp ESLint',
    category: 'Lint',
    display: 'npm --workspace webapp run lint',
    args: () => checkArgs.npmWorkspaceRun('webapp', 'lint'),
    parser: 'none',
}
