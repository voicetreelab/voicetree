import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'dead-code',
    name: 'Dead Code (knip)',
    category: 'Static',
    display: 'npm exec -- knip --no-progress --no-config-hints --include files,exports',
    args: () => checkArgs.npmExec('knip', '--no-progress', '--no-config-hints', '--include', 'files,exports'),
    parser: 'none',
}
