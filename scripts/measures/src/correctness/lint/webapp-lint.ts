import {type CheckDef, npmWorkspaceRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'webapp-lint',
    name: 'Webapp ESLint',
    category: 'Lint',
    display: 'npm --workspace webapp run lint',
    args: () => npmWorkspaceRun('webapp', 'lint'),
    parser: 'none',
}
