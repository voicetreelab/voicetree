import {type CheckDef} from '../../_types.ts'

const SCRIPT_PATH = 'packages/measures/src/_runners/check-project-vocabulary.ts'

export const check: CheckDef = {
    id: 'project-vocabulary',
    name: 'Project Vocabulary',
    category: 'Static',
    display: `node ${SCRIPT_PATH}`,
    args: () => ['node', '--no-warnings=ExperimentalWarning', '--experimental-strip-types', SCRIPT_PATH],
    parser: 'none',
}
