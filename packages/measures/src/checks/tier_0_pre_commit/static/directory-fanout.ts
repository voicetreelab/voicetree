import {type CheckDef} from '../../../_types.ts'

const SCRIPT_PATH = 'packages/measures/src/_runners/check-directory-fanout.ts'

export const check: CheckDef = {
    id: 'directory-fanout',
    name: 'Directory Fanout',
    category: 'Static',
    display: `node ${SCRIPT_PATH}`,
    args: () => ['node', '--no-warnings=ExperimentalWarning', '--experimental-strip-types', SCRIPT_PATH],
    parser: 'none',
}
