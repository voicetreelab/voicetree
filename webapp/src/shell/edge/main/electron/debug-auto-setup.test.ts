import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { registerDebugAutoSetup, type DebugSetupImporter } from './debug-auto-setup';

type PrettySetupFn = () => Promise<{
    terminalsSpawned: string[];
    nodeCount: number;
    projectLoaded?: string;
}>;

type MainWindowMock = {
    webContents: {
        once: Mock<(event: string, callback: () => void) => void>;
    };
};

function createMainWindowMock(): MainWindowMock {
    return {
        webContents: {
            once: vi.fn<(event: string, callback: () => void) => void>(),
        },
    };
}

describe('registerDebugAutoSetup', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('invokes prettySetup once after did-finish-load when VT_DEBUG_AUTOLAUNCHED=1', async () => {
        const mainWindow: MainWindowMock = createMainWindowMock();
        const prettySetupAppForElectronDebugging: Mock<PrettySetupFn> = vi.fn(async () => ({
            terminalsSpawned: [],
            nodeCount: 3,
            projectLoaded: '/tmp/example_small',
        }));
        const importDebugSetup: DebugSetupImporter = vi.fn(async () => ({
            prettySetupAppForElectronDebugging,
        }));

        const setupComplete: Promise<void> | null = registerDebugAutoSetup(mainWindow, {
            env: { VT_DEBUG_AUTOLAUNCHED: '1' },
            importDebugSetup,
        });

        expect(setupComplete).not.toBeNull();
        expect(mainWindow.webContents.once).toHaveBeenCalledOnce();
        expect(mainWindow.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function));

        const onDidFinishLoad: () => void = mainWindow.webContents.once.mock.calls[0][1] as () => void;
        onDidFinishLoad();
        await setupComplete;

        expect(importDebugSetup).toHaveBeenCalledOnce();
        expect(prettySetupAppForElectronDebugging).toHaveBeenCalledOnce();
        expect(prettySetupAppForElectronDebugging).toHaveBeenCalledWith();
    });

    it('does not register auto-setup when vt-debug autolaunch env is unset', () => {
        const mainWindow: MainWindowMock = createMainWindowMock();
        const importDebugSetup: DebugSetupImporter = vi.fn(async () => {
            throw new Error('should not be called');
        });

        const setupComplete: Promise<void> | null = registerDebugAutoSetup(mainWindow, {
            env: {},
            importDebugSetup,
        });

        expect(setupComplete).toBeNull();
        expect(mainWindow.webContents.once).not.toHaveBeenCalled();
        expect(importDebugSetup).not.toHaveBeenCalled();
    });
});
