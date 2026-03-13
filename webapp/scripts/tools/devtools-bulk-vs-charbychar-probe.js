/**
 * DevTools probe: bulk-write vs char-by-char message delivery.
 *
 * Paste into Electron renderer DevTools console.
 *
 * Tests two approaches for sending messages to agent terminals:
 *   A) char-by-char (current) — each character written individually with 5ms delay
 *   B) bulk-write (proposed) — message body as single write, escape sequences still char-by-char
 *
 * Both use the same preamble (SPACE ESC i Ctrl-U) and dual submit (ESC+CR then CR).
 *
 * Usage:
 *   submitProbe.listTerminalIds()
 *   await submitProbe.compare({ terminalId: 'Ari', text: 'reply with just OK' })
 *   await submitProbe.compare({ terminalId: 'Dae', text: 'reply with just OK' })
 *
 *   // Run multiple trials to catch intermittent failures:
 *   await submitProbe.stress({ terminalId: 'Ari', trials: 5, text: 'reply OK' })
 */
(function installSubmitProbe(globalObj) {
  const root = globalObj;
  const termApi = root?.electronAPI?.terminal;
  if (!termApi || typeof termApi.write !== 'function' || typeof termApi.onData !== 'function') {
    console.error('[submitProbe] window.electronAPI.terminal is unavailable.');
    return;
  }

  const CHAR_DELAY_MS = 5;
  const ESC_DELAY_MS = 100;
  const INSERT_MODE_DELAY_MS = 50;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function listTerminalIds() {
    return Array.from(new Set(
      Array.from(document.querySelectorAll('.cy-floating-window-terminal[data-floating-window-id]'))
        .map(n => n.getAttribute('data-floating-window-id'))
        .filter(Boolean)
    ));
  }

  function startCapture(terminalId) {
    const chunks = [];
    const t0 = Date.now();
    const unsub = termApi.onData((id, data) => {
      if (id === terminalId) chunks.push({ ts: Date.now() - t0, data });
    });
    return {
      stop() {
        if (typeof unsub === 'function') unsub();
        const output = chunks.map(c => c.data).join('');
        return { chunks: chunks.length, chars: output.length, output };
      }
    };
  }

  // Shared preamble: SPACE -> ESC -> i -> Ctrl-U
  async function sendPreamble(terminalId) {
    await termApi.write(terminalId, ' ');
    await sleep(ESC_DELAY_MS);
    await termApi.write(terminalId, '\x1b');
    await sleep(ESC_DELAY_MS);
    await termApi.write(terminalId, 'i');
    await sleep(INSERT_MODE_DELAY_MS);
    await termApi.write(terminalId, '\x15');
    await sleep(CHAR_DELAY_MS);
  }

  // Shared dual submit: ESC CR (char-by-char) then trailing CR
  async function sendDualSubmit(terminalId) {
    await sleep(CHAR_DELAY_MS);
    await termApi.write(terminalId, '\x1b');
    await sleep(CHAR_DELAY_MS);
    await termApi.write(terminalId, '\r');
    await sleep(ESC_DELAY_MS);
    await termApi.write(terminalId, '\r');
  }

  // --- Strategy A: char-by-char (current production code) ---
  async function sendCharByChar(terminalId, text) {
    await sendPreamble(terminalId);
    for (const ch of text) {
      await sleep(CHAR_DELAY_MS);
      await termApi.write(terminalId, ch);
    }
    await sendDualSubmit(terminalId);
  }

  // --- Strategy B: bulk message body, escape sequences still char-by-char ---
  async function sendBulkBody(terminalId, text) {
    await sendPreamble(terminalId);
    await sleep(CHAR_DELAY_MS);
    await termApi.write(terminalId, text); // single write for entire message
    await sendDualSubmit(terminalId);
  }

  // --- Strategy C: bulk body + bulk submit (ESC+CR as single write) ---
  async function sendBulkAll(terminalId, text) {
    await sendPreamble(terminalId);
    await sleep(CHAR_DELAY_MS);
    await termApi.write(terminalId, text); // single write for message
    await sleep(CHAR_DELAY_MS);
    await termApi.write(terminalId, '\x1b\r'); // ESC+CR as single write
    await sleep(ESC_DELAY_MS);
    await termApi.write(terminalId, '\r'); // trailing CR
  }

  const STRATEGIES = {
    'A_charByChar': sendCharByChar,
    'B_bulkBody': sendBulkBody,
    'C_bulkAll': sendBulkAll,
  };

  async function runTrial(terminalId, strategy, text, dwellMs) {
    const cap = startCapture(terminalId);
    const t0 = performance.now();

    await STRATEGIES[strategy](terminalId, text);

    const sendMs = Math.round(performance.now() - t0);
    await sleep(dwellMs);
    const result = cap.stop();

    return {
      strategy,
      sendMs,
      outputChunks: result.chunks,
      outputChars: result.chars,
      flushed: result.chars > 0,
      outputTail: result.output.slice(-200).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').slice(-120),
    };
  }

  /**
   * Compare all three strategies on one terminal.
   * @param {Object} opts
   * @param {string} opts.terminalId - e.g. 'Ari' or 'Dae'
   * @param {string} [opts.text] - message to send (default: 'submit-probe: reply OK')
   * @param {number} [opts.dwellMs] - how long to wait for agent response (default: 4000)
   * @param {number} [opts.pauseMs] - pause between strategies (default: 6000)
   */
  async function compare(opts = {}) {
    const terminalId = opts.terminalId;
    if (!terminalId) throw new Error('terminalId required');
    const text = opts.text ?? 'submit-probe: reply with just the word OK';
    const dwellMs = opts.dwellMs ?? 4000;
    const pauseMs = opts.pauseMs ?? 6000;

    console.log(`[submitProbe] comparing strategies on terminal=${terminalId}`);

    const results = [];
    for (const strategy of Object.keys(STRATEGIES)) {
      const runId = Date.now().toString(36);
      const taggedText = `${text} [${runId}:${strategy}]`;

      console.log(`  -> ${strategy} ...`);
      const result = await runTrial(terminalId, strategy, taggedText, dwellMs);
      results.push(result);
      console.log(`     flushed=${result.flushed} sendMs=${result.sendMs} outputChars=${result.outputChars}`);

      if (strategy !== Object.keys(STRATEGIES).at(-1)) {
        console.log(`     waiting ${pauseMs}ms for agent to settle...`);
        await sleep(pauseMs);
      }
    }

    console.table(results.map(r => ({
      strategy: r.strategy,
      flushed: r.flushed ? 'YES' : 'NO',
      sendMs: r.sendMs,
      outputChars: r.outputChars,
      outputChunks: r.outputChunks,
    })));

    return results;
  }

  /**
   * Stress test: run one strategy N times to catch intermittent failures.
   * @param {Object} opts
   * @param {string} opts.terminalId
   * @param {string} [opts.strategy] - default 'B_bulkBody'
   * @param {number} [opts.trials] - default 5
   * @param {string} [opts.text]
   * @param {number} [opts.dwellMs] - default 4000
   * @param {number} [opts.pauseMs] - default 8000
   */
  async function stress(opts = {}) {
    const terminalId = opts.terminalId;
    if (!terminalId) throw new Error('terminalId required');
    const strategy = opts.strategy ?? 'B_bulkBody';
    const trials = opts.trials ?? 5;
    const text = opts.text ?? 'stress-probe: reply OK';
    const dwellMs = opts.dwellMs ?? 4000;
    const pauseMs = opts.pauseMs ?? 8000;

    console.log(`[submitProbe] stress ${strategy} x${trials} on terminal=${terminalId}`);

    const results = [];
    for (let i = 0; i < trials; i++) {
      const runId = Date.now().toString(36);
      const taggedText = `${text} [${runId}:trial${i + 1}]`;
      console.log(`  trial ${i + 1}/${trials} ...`);

      const result = await runTrial(terminalId, strategy, taggedText, dwellMs);
      results.push({ trial: i + 1, ...result });
      console.log(`    flushed=${result.flushed} sendMs=${result.sendMs}`);

      if (i < trials - 1) await sleep(pauseMs);
    }

    const successes = results.filter(r => r.flushed).length;
    console.log(`\n[submitProbe] ${successes}/${trials} flushed successfully`);
    console.table(results.map(r => ({
      trial: r.trial,
      flushed: r.flushed ? 'YES' : 'NO',
      sendMs: r.sendMs,
      outputChars: r.outputChars,
    })));

    return results;
  }

  root.submitProbe = {
    listTerminalIds,
    compare,
    stress,
    STRATEGIES: Object.keys(STRATEGIES),
  };

  console.log(
    '[submitProbe] installed. Terminals: ' + JSON.stringify(listTerminalIds()) +
    '\n\nUsage:' +
    '\n  await submitProbe.compare({ terminalId: "Ari" })' +
    '\n  await submitProbe.compare({ terminalId: "Dae" })' +
    '\n  await submitProbe.stress({ terminalId: "Ari", trials: 5 })' +
    '\n  await submitProbe.stress({ terminalId: "Ari", strategy: "C_bulkAll", trials: 5 })'
  );
})(window);
