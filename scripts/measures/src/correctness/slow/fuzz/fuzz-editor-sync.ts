import {type CheckDef, E2E_TIMEOUT_MS, npmRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-editor-sync',
    name: 'Fuzz: editor sync',
    category: 'Integration',
    display: 'npm run test:fuzz -- webapp/src/shell/edge/UI-edge/floating-windows/editors/EditorSync.fuzz.test.ts',
    args: (jsonOut) => npmRun('test:fuzz', [...vitestJsonArgs(jsonOut), 'webapp/src/shell/edge/UI-edge/floating-windows/editors/EditorSync.fuzz.test.ts']),
    parser: 'vitest',
    slow: true,
    timeoutMs: E2E_TIMEOUT_MS,
}
