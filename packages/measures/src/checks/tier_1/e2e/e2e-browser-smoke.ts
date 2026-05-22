import {type CheckDef, E2E_TIMEOUT_MS, npmWorkspaceExec, playwrightJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-browser-smoke',
    name: 'E2E Browser Smoke',
    category: 'E2E',
    display: 'npm --workspace webapp exec -- playwright test --config=playwright-ci-smoke.config.ts',
    args: () => npmWorkspaceExec('webapp', 'playwright', 'test', '--config=playwright-ci-smoke.config.ts', ...playwrightJsonArgs()),
    parser: 'playwright',
    timeoutMs: E2E_TIMEOUT_MS,
}
