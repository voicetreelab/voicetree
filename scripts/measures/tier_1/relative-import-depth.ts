import {type CheckDef} from '../_types.ts'

export const check: CheckDef = {
    id: 'relative-import-depth',
    name: 'Relative Import Depth',
    category: 'Static',
    display: 'node scripts/measure-relative-imports.mjs --enforce',
    args: () => ['node', 'scripts/measure-relative-imports.mjs', '--enforce'],
    parser: 'none',
}
