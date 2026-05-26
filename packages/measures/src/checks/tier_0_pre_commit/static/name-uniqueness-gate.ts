import {type CheckDef} from '../../_types.ts'

const SCRIPT_PATH = 'packages/measures/src/_runners/check-name-uniqueness.ts'

export const check: CheckDef = {
    id: 'name-uniqueness',
    name: 'Name Uniqueness',
    category: 'Static',
    display: `node ${SCRIPT_PATH}`,
    args: () => ['node', '--no-warnings=ExperimentalWarning', '--experimental-strip-types', SCRIPT_PATH],
    parser: 'none',
}
