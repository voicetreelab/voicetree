import { _electron as electron } from '@playwright/test';
import * as path from 'path';
import { resolveGraphDaemonNodeBin } from '@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers';
import { CI_FLAGS, PROJECT_ROOT } from './paths';

export function launchProjectSelectionApp(tempUserDataPath: string) {
    return electron.launch({
        args: [
            ...CI_FLAGS,
            path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
            `--user-data-dir=${tempUserDataPath}`
        ],
        env: {
            ...process.env,
            NODE_ENV: 'test',
            HEADLESS_TEST: '1',
            MINIMIZE_TEST: '1',
            VOICETREE_PERSIST_STATE: '1',
            VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        },
        timeout: 15000
    });
}
