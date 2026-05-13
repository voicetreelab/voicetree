import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'verify-cytoscape-rules',
    name: 'Cytoscape Lint Rules',
    category: 'Lint',
    display: 'npm run lint:verify-cytoscape-rules',
    args: () => npmRun('lint:verify-cytoscape-rules'),
    parser: 'none',
}
