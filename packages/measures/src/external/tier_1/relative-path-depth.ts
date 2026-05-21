import {type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'relative-path-depth',
    name: 'Relative Path Depth',
    category: 'Static',
    display: 'node scripts/measure-relative-paths.mjs --enforce',
    args: () => ['node', 'scripts/measure-relative-paths.mjs', '--enforce'],
    parser: 'none',
}
