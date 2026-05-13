import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'coupling',
    name: 'Cross-Package Coupling',
    category: 'Static',
    display: 'npm run check:coupling',
    args: () => npmRun('check:coupling'),
    parser: 'none',
}
