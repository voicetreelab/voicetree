import type { BrowserWindow } from 'electron';
import type { DebugSetupResult } from '@/shell/edge/main/debug/prettySetupAppForElectronDebugging';

type DebugSetupModule = {
    prettySetupAppForElectronDebugging: () => Promise<DebugSetupResult>;
};

export type DebugSetupImporter = () => Promise<DebugSetupModule>;

function importDebugSetupModule(): Promise<DebugSetupModule> {
    return import('@/shell/edge/main/debug/prettySetupAppForElectronDebugging');
}

function getDebugAutoSetupReason(env: NodeJS.ProcessEnv): string | null {
    if (env.VT_DEBUG_AUTOLAUNCHED === '1') {
        return 'vt-debug autolaunch';
    }

    if (env.ENABLE_PLAYWRIGHT_DEBUG === '1') {
        return 'Playwright debug';
    }

    return null;
}

export function registerDebugAutoSetup(
    mainWindow: Pick<BrowserWindow, 'webContents'> | undefined,
    options: {
        env?: NodeJS.ProcessEnv;
        importDebugSetup?: DebugSetupImporter;
    } = {}
): Promise<void> | null {
    const env: NodeJS.ProcessEnv = options.env ?? process.env;
    const reason: string | null = getDebugAutoSetupReason(env);

    if (!mainWindow || reason === null) {
        return null;
    }

    const importDebugSetup: DebugSetupImporter = options.importDebugSetup ?? importDebugSetupModule;

    return new Promise((resolve) => {
        mainWindow.webContents.once('did-finish-load', () => {
            void importDebugSetup()
                .then(({ prettySetupAppForElectronDebugging }) => prettySetupAppForElectronDebugging())
                .then((result) => {
                    console.log(`[Startup] ${reason} auto-setup complete:`, JSON.stringify(result));
                })
                .catch((err: unknown) => {
                    console.error(`[Startup] ${reason} auto-setup failed:`, err);
                })
                .finally(resolve);
        });
    });
}
