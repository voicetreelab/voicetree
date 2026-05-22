import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApp } = vi.hoisted(() => ({
  mockApp: {
    commandLine: {
      appendSwitch: vi.fn(),
      getSwitchValue: vi.fn(() => ''),
      hasSwitch: vi.fn(() => false),
    },
    getPath: vi.fn(() => '/tmp/voicetree-test-user-data'),
    isPackaged: false,
    setName: vi.fn(),
    setPath: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('fix-path', () => ({
  default: vi.fn(),
}));

import {
  chooseCdpPort,
  configureEnvironment,
  parseRemoteDebuggingPortArg,
  shouldAutoEnablePlaywrightDebug,
} from '@/shell/edge/main/runtime/electron/app/environment-config';

describe('environment-config CDP port selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_PLAYWRIGHT_DEBUG = '1';
    process.env.NODE_ENV = 'development';
    process.env.VOICETREE_PERSIST_STATE = '1';
    delete process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
  });

  it('uses Playwright remote-debugging-port argv before the local cdp-port helper', () => {
    const argvPort: string | null = parseRemoteDebuggingPortArg([
      'Electron',
      '--remote-debugging-port=0',
      'dist-electron/main/index.js',
    ]);

    expect(chooseCdpPort(argvPort, undefined, '9222')).toBe('0');
  });

  it('uses an explicit CDP endpoint when argv does not configure a port', () => {
    expect(chooseCdpPort(null, 'http://127.0.0.1:9333', '9222')).toBe('9333');
  });

  it('falls back to an ephemeral port when all explicit sources are absent or invalid', () => {
    expect(chooseCdpPort(null, 'not-a-url', 'not-a-port')).toBe('0');
  });

  it('does not auto-enable vt-debug CDP during Electron tests', () => {
    expect(shouldAutoEnablePlaywrightDebug({ NODE_ENV: 'test' }, false)).toBe(false);
    expect(shouldAutoEnablePlaywrightDebug({ HEADLESS_TEST: '1' }, false)).toBe(false);
    expect(shouldAutoEnablePlaywrightDebug({}, false)).toBe(true);
  });

  it('does not append .cdp-port when Electron commandLine already has Playwright port 0', () => {
    vi.mocked(mockApp.commandLine.hasSwitch).mockReturnValue(true);
    vi.mocked(mockApp.commandLine.getSwitchValue).mockReturnValue('0');

    configureEnvironment();

    expect(mockApp.commandLine.appendSwitch).not.toHaveBeenCalledWith('remote-debugging-port', '9222');
  });
});
