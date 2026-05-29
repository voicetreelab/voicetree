import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-editor-sync',
    name: 'Fuzz: editor sync',
    category: 'Integration',
    display: 'pnpm exec vitest run --config vitest.config.fuzz.ts webapp/src/shell/edge/UI-edge/floating-windows/editors/EditorSync.fuzz.test.ts',
    args: (jsonOut) => checkArgs.fuzzVitestArgs(jsonOut, 'webapp/src/shell/edge/UI-edge/floating-windows/editors/EditorSync.fuzz.test.ts'),
    parser: 'vitest',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
