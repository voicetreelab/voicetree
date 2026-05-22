import { expect } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

export const WEBAPP_ROOT = path.resolve(process.cwd());
const REPO_ROOT = path.resolve(WEBAPP_ROOT, '..');

export type ElectronDiagnostics = {
  mainOutput: string[];
  rendererErrors: string[];
};

export type SmokeElectronAPI = Omit<ElectronAPI, 'terminal'> & {
  terminal: {
    spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>;
  };
};

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: SmokeElectronAPI;
}

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
  try {
    execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveGraphDaemonNodeBin(): string {
  const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node');
  const candidates = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
    'node'
  ].filter((candidate): candidate is string => !!candidate);

  return candidates.find(canLoadNativeGraphDbModules) ?? process.execPath;
}

function escapeProcessPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stopSmokeGraphDaemonForVault(vaultPath: string): void {
  try {
    execFileSync('pkill', ['-f', `vt-graphd\\.ts --vault ${escapeProcessPattern(vaultPath)}`], {
      stdio: 'ignore'
    });
  } catch {
    // No matching smoke daemon is fine.
  }
}

export function expectNoCriticalElectronErrors(diagnostics: ElectronDiagnostics): void {
  const criticalErrorPatterns = [
    /NODE_MODULE_VERSION/i,
    /was compiled against a different Node\.js version/i,
    /DaemonLaunchTimeout/i,
    /ERR_DLOPEN_FAILED/i,
    /Error invoking remote method/i,
    /An object could not be cloned/i,
    /\[spawnTerminalWithContextNode\] async spawn failed/i,
    /ERR_MODULE_NOT_FOUND/i,
    /is not a function or its return value is not iterable/i
  ];
  const criticalErrors = [...diagnostics.mainOutput, ...diagnostics.rendererErrors]
    .filter(line => criticalErrorPatterns.some(pattern => pattern.test(line)));

  expect(criticalErrors).toEqual([]);
}
