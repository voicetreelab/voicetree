/**
 * E2E Test: Voice → Tree, full REAL loop (mock mic input only)
 *
 * This is the confidence test for "voice mode": it drives the COMPLETE pipeline
 * end-to-end with the ONLY mock being the microphone input (there is no mic in an
 * automated run). Everything downstream is real:
 *
 *   window.__VOICE_TEST__.emitVoiceResult(tokens)   <- the SAME callback the Soniox
 *        |                                             SDK invokes via onPartialResult
 *        v
 *   onVoiceResult (TranscriptionStore)  ->  useTranscriptionSender
 *        |
 *        v  POST /send-text   (REAL renderer send path, no stub)
 *   server.py (USE_REAL_SERVER=1)  ->  deployed cloud-function agents (REAL LLM)
 *        |
 *        v  writes REAL markdown nodes  ->  electron file-watch  ->  graph delta
 *        v
 *   assert REAL nodes appear in Cytoscape
 *
 * We deliberately do NOT POST /load-directory ourselves — the app's own
 * project-open wiring (via --open-folder) must notify the backend. If that wiring
 * is broken (the suspected "no nodes appear" bug), this test fails and reproduces it.
 *
 * Requirements to run: network access to the cloud agents + .env GEMINI_API_KEY
 * (server.py load_dotenv). Renderer must be built with VITE_E2E_TEST=true so the
 * mock-Soniox seam is present. Expected runtime up to ~2 min (real LLM).
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import {
  pollForCytoscape,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
  getCiElectronFlags,
} from '@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

interface FakeToken { text: string; is_final: boolean }

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  __VOICE_TEST__?: { emitVoiceResult: (result: { tokens: FakeToken[] }) => void };
  electronAPI?: {
    main: {
      getBackendPort: () => Promise<number>;
      stopFileWatching: () => Promise<{ success: boolean }>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempProjectPath: string;
}>({
  tempProjectPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-voice-to-tree-e2e-'));
    const projectRoot = path.join(tempDir, 'test-project');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'root.md'),
      '# Root\n\nVoice-to-tree real-loop E2E test.\n',
      'utf8'
    );
    await use(projectRoot);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ tempProjectPath }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-voice2tree-userdata-'));
    // Persist config for project-config reads; startup project comes from --open-folder.
    await fs.writeFile(
      path.join(tempUserDataPath, 'voicetree-config.json'),
      JSON.stringify({ lastDirectory: tempProjectPath }, null, 2),
      'utf8'
    );

    console.log('[Voice-to-Tree E2E] Test project:', tempProjectPath);
    console.log('[Voice-to-Tree E2E] REAL Python backend + REAL cloud-agent LLM');

    const electronApp = await electron.launch({
      args: [
        ...getCiElectronFlags(),
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder',
        tempProjectPath,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        USE_REAL_SERVER: '1',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
      timeout: 45000,
    });

    await use(electronApp);

    // DIAGNOSTIC: copy the backend debug log out before cleanup.
    try {
      const log = await fs.readFile(path.join(tempUserDataPath, 'server-debug.log'), 'utf8');
      console.log('\n===== server-debug.log (tail) =====\n' + log.split('\n').slice(-60).join('\n'));
    } catch (e) { console.log('no server-debug.log:', String(e)); }

    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 45000 });
    window.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    window.on('pageerror', error => console.error('PAGE ERROR:', error.message));
    await window.waitForLoadState('domcontentloaded');
    await pollForCytoscape(window, 45000);
    await window.waitForTimeout(500); // let the startup project-open settle
    await use(window);
  }
});

async function backendNodeCount(page: Page, port: number): Promise<number> {
  return page.evaluate(async (p) => {
    const res = await fetch(`http://localhost:${p}/health`);
    const h = await res.json();
    return (h.nodes as number) || 0;
  }, port);
}

function cytoscapeRealNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return 0;
    return cy.nodes().filter((n: NodeSingular) => {
      const id = n.id();
      return !id.startsWith('GHOST') && !id.includes('virtual');
    }).length;
  });
}

test.describe('Voice → Tree (real backend, mock mic only)', () => {
  test.setTimeout(180000);

  test('emitted Soniox tokens create real nodes through the live pipeline', async ({ appWindow }) => {
    // ---- backend up (real Python server) ----
    const backendPort = await appWindow.evaluate(async () =>
      (window as unknown as ExtendedWindow).electronAPI!.main.getBackendPort()
    );
    expect(backendPort).toBeGreaterThan(8000);
    console.log(`[E2E] Backend port: ${backendPort}`);

    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i++) {
      healthy = await appWindow.evaluate(async (p) => {
        try { return (await fetch(`http://localhost:${p}/health`)).ok; } catch { return false; }
      }, backendPort);
      if (!healthy) await appWindow.waitForTimeout(1000);
    }
    expect(healthy).toBe(true);
    console.log('[E2E] Backend healthy');

    // ---- test seam present (proves VITE_E2E_TEST build) ----
    await appWindow.waitForFunction(
      () => (window as unknown as ExtendedWindow).__VOICE_TEST__ !== undefined,
      { timeout: 15000 }
    );

    // Give the app's project-open flow time to notify the backend of the directory.
    await appWindow.waitForTimeout(3000);
    const initialBackendNodes = await backendNodeCount(appWindow, backendPort);
    const initialCyNodes = await cytoscapeRealNodeCount(appWindow);
    console.log(`[E2E] Initial: backend nodes=${initialBackendNodes}, cytoscape nodes=${initialCyNodes}`);

    // ---- emit fake Soniox tokens (the only mock: the mic) ----
    // >133 chars so the server buffer threshold flushes promptly (else 15s auto-flush).
    const spokenText =
      'I am researching machine learning for image classification. ' +
      'Convolutional neural networks are very effective at computer vision tasks ' +
      'like object detection and image segmentation, and transfer learning speeds this up.';

    await appWindow.evaluate((text) => {
      (window as unknown as ExtendedWindow).__VOICE_TEST__!.emitVoiceResult({
        tokens: [{ text, is_final: true }]
      });
    }, spokenText);
    console.log(`[E2E] Emitted ${spokenText.length} chars of fake transcription`);

    // ---- wait for the REAL pipeline to create a node ----
    const deadline = Date.now() + 150000;
    let backendNodes = initialBackendNodes;
    while (Date.now() < deadline) {
      backendNodes = await backendNodeCount(appWindow, backendPort);
      if (backendNodes > initialBackendNodes) {
        console.log(`[E2E] Backend created node(s): ${initialBackendNodes} → ${backendNodes}`);
        break;
      }
      await appWindow.waitForTimeout(2000);
    }
    expect(backendNodes,
      'real /send-text → cloud-agent pipeline should create at least one node'
    ).toBeGreaterThan(initialBackendNodes);

    // ---- the node should surface in the renderer via file-watch ----
    let cyNodes = initialCyNodes;
    const cyDeadline = Date.now() + 30000;
    while (Date.now() < cyDeadline) {
      cyNodes = await cytoscapeRealNodeCount(appWindow);
      if (cyNodes > initialCyNodes) break;
      await appWindow.waitForTimeout(1000);
    }
    console.log(`[E2E] Cytoscape nodes: ${initialCyNodes} → ${cyNodes}`);
    expect(cyNodes,
      'new backend node should propagate to the renderer graph via file-watch'
    ).toBeGreaterThan(initialCyNodes);

    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'e2e-tests/test-results/voice-to-tree-e2e-final.png'),
      fullPage: true
    });
    console.log('✅ Voice → Tree real-loop E2E passed');
  });
});

export { test };
