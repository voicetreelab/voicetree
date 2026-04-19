import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFs, mockFixPath, mockSetStartupFolderOverride, mockApp, getUserDataPath } = vi.hoisted(() => {
    let userDataPath: string = '/Users/test/Library/Application Support/Voicetree';

    const app = {
        setName: vi.fn(),
        setPath: vi.fn((name: string, value: string) => {
            if (name === 'userData') {
                userDataPath = value;
            }
        }),
        getPath: vi.fn((name: string) => {
            if (name === 'userData') {
                return userDataPath;
            }
            throw new Error(`Unexpected getPath(${name})`);
        }),
        commandLine: {
            appendSwitch: vi.fn(),
        },
    };

    return {
        mockFs: {
            mkdirSync: vi.fn(),
            readFileSync: vi.fn(() => {
                throw new Error('missing .cdp-port');
            }),
        },
        mockFixPath: vi.fn(),
        mockSetStartupFolderOverride: vi.fn(),
        mockApp: app,
        getUserDataPath: (): string => userDataPath,
    };
});

vi.mock('fs', () => ({
    default: mockFs,
}));

vi.mock('fix-path', () => ({
    default: mockFixPath,
}));

vi.mock('electron', () => ({
    app: mockApp,
}));

vi.mock('@/shell/edge/main/state/watch-folder-store', () => ({
    setStartupFolderOverride: mockSetStartupFolderOverride,
}));

async function loadModule(): Promise<typeof import('./environment-config')> {
    vi.resetModules();
    return import('./environment-config');
}

describe('environment-config', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.NODE_ENV;
        delete process.env.VOICETREE_PERSIST_STATE;
        delete process.env.ENABLE_PLAYWRIGHT_DEBUG;
        delete process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
    });

    it('creates the active dev userData directory before enabling ephemeral CDP', async () => {
        process.env.NODE_ENV = 'development';

        const { configureEnvironment, getConfiguredCdpPort } = await loadModule();

        configureEnvironment();

        expect(mockFixPath).toHaveBeenCalledOnce();
        expect(mockApp.setPath).toHaveBeenCalledOnce();
        expect(getUserDataPath()).toMatch(/voicetree-fresh-\d+$/);
        expect(mockFs.mkdirSync).toHaveBeenCalledWith(getUserDataPath(), { recursive: true });
        expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('remote-debugging-port', '0');
        expect(mockFs.mkdirSync.mock.invocationCallOrder[0]).toBeLessThan(
            mockApp.commandLine.appendSwitch.mock.invocationCallOrder[0]
        );
        expect(getConfiguredCdpPort()).toBe('0');
    });
});
