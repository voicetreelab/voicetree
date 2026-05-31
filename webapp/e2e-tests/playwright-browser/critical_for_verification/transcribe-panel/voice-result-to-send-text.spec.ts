/**
 * Browser E2E: fake Soniox token stream -> POST /send-text
 *
 * Covers the exact path that silently broke and had zero automated coverage:
 *
 *   window.__VOICE_TEST__.emitVoiceResult(tokens)   (the SAME callback the
 *        |                                            Soniox SDK invokes via
 *        v                                            onPartialResult)
 *   onVoiceResult  (TranscriptionStore)
 *        |
 *        v
 *   useTranscriptionSender  (subscribes to store, sends new final tokens)
 *        |
 *        v
 *   POST /send-text
 *
 * No mic, no Soniox network — we inject deterministic is_final tokens into the
 * real renderer path and assert the outbound request. The /send-text call is
 * intercepted and stubbed via page.route so no backend is required.
 *
 * Precondition for the server-send branch: NO editor/terminal focused (a focused
 * floating window would route tokens to the preview chip instead of the server).
 * A freshly-booted graph view has no floating windows, so this holds by default.
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

// Minimal Soniox token shape the renderer path consumes.
interface FakeToken {
  text: string;
  is_final: boolean;
}

declare global {
  interface Window {
    __VOICE_TEST__?: {
      emitVoiceResult: (result: { tokens: FakeToken[] }) => void;
    };
  }
}

test.describe('Voice result -> /send-text (mock Soniox seam)', () => {
  test('emitted final tokens fire a POST /send-text with the spoken text', async ({ page }) => {
    // Boot the app to the graph view; this mounts VoiceTreeTranscribe, whose
    // useTranscriptionSender subscribes to the TranscriptionStore.
    await setupMockElectronAPI(page);
    await page.goto('/');
    await waitForCytoscapeReady(page);

    // The test seam is installed at module load, gated to non-prod builds.
    await page.waitForFunction(() => window.__VOICE_TEST__ !== undefined, { timeout: 10000 });

    // Intercept the outbound /send-text request and stub a 200 response, so no
    // real backend is needed. Capture the first request body for assertion.
    const sendTextBody = new Promise<{ text: string; force_flush: boolean }>((resolve) => {
      void page.route('**/send-text', async (route) => {
        const body = route.request().postDataJSON() as { text: string; force_flush: boolean };
        resolve(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ buffer_length: body.text.length }),
        });
      });
    });

    const spokenText = 'hello voicetree from the mock soniox seam';

    // Emit deterministic final tokens into the exact callback Soniox would call.
    await page.evaluate((text) => {
      window.__VOICE_TEST__!.emitVoiceResult({
        tokens: [{ text, is_final: true }],
      });
    }, spokenText);

    // The store notifies the sender, which posts the new final text to the server.
    const body = await sendTextBody;

    expect(body.text).toBe(spokenText);
    // Incremental (streamed) tokens are sent without force_flush.
    expect(body.force_flush).toBe(false);
  });
});
