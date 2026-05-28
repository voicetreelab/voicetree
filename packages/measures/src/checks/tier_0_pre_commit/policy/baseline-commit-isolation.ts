import {type CheckDef} from '../../_types.ts'

const SCRIPT_PATH = 'packages/measures/scripts/check-baseline-commit-isolation.ts'

export const check: CheckDef = {
    id: 'baseline-commit-isolation',
    name: 'Baselines must be their own commit',
    category: 'Static',
    display: `node ${SCRIPT_PATH}`,
    args: () => ['node', '--no-warnings=ExperimentalWarning', '--experimental-strip-types', SCRIPT_PATH],
    parser: 'none',
}
