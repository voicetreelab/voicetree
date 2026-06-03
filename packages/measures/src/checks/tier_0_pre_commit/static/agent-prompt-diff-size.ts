import {type CheckDef} from '../../_types.ts'

const SCRIPT_PATH = 'packages/measures/src/checks/tier_0_pre_commit/static/_agent-prompt-diff-size-runner.ts'

export const check: CheckDef = {
    id: 'agent-prompt-diff-size',
    name: 'Agent prompt diff size',
    category: 'Static',
    display: `node ${SCRIPT_PATH}`,
    args: () => ['node', '--no-warnings=ExperimentalWarning', '--experimental-strip-types', SCRIPT_PATH],
    parser: 'none',
}
