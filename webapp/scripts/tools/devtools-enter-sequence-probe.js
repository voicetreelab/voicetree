/**
 * DevTools Enter-sequence probe for interactive terminals.
 *
 * Paste this file's contents into Electron renderer DevTools console.
 *
 * What it does:
 * - Sends controlled byte sequences to an active terminal via window.electronAPI.terminal.write().
 * - Captures terminal output for each trial so you can compare which Enter variant triggers submit.
 * - Optionally installs an input sniffer that logs bytes written from UI keypresses.
 *
 * Typical usage:
 *   enterProbe.listTerminalIds()
 *   await enterProbe.sweep({
 *     terminalId: enterProbe.resolveTerminalId('Anna'),
 *     text: 'enter probe: please reply OK',
 *     modes: ['raw', 'legacyPreamble'],
 *     dwellMs: 2200
 *   })
 *
 *   // Optional: log raw write bytes while you manually press Enter / Shift+Enter
 *   enterProbe.installWriteSniffer()
 *   // ...press keys in the terminal...
 *   enterProbe.removeWriteSniffer()
 */
(function installEnterProbe(globalObj) {
  const root = globalObj;
  const termApi = root?.electronAPI?.terminal;
  if (!termApi || typeof termApi.write !== 'function' || typeof termApi.onData !== 'function') {
    console.error('[enterProbe] window.electronAPI.terminal is unavailable in this context.');
    return;
  }

  const state = {
    originalWrite: null,
    snifferInstalled: false,
  };

  const DEFAULT_CANDIDATES = [
    { name: 'CR', sequence: '\r' },
    { name: 'LF', sequence: '\n' },
    { name: 'CRLF', sequence: '\r\n' },
    { name: 'ESC+CR (Option/Alt+Enter style)', sequence: '\x1b\r' },
    { name: 'ESC+LF', sequence: '\x1b\n' },
    { name: 'CSI-u Enter', sequence: '\x1b[13u' },
    { name: 'CSI-u Shift+Enter', sequence: '\x1b[13;2u' },
    { name: 'CSI-u Alt+Enter', sequence: '\x1b[13;3u' },
  ];
  const PREFERRED_TERMINAL_ID = 'Anna';

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function toHex(input) {
    return Array.from(input, (char) =>
      char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
    ).join(' ');
  }

  function toVisible(input) {
    return input
      .replace(/\x1b/g, '<ESC>')
      .replace(/\r/g, '<CR>')
      .replace(/\n/g, '<LF>\n')
      .replace(/\t/g, '<TAB>');
  }

  function compactVisible(input, maxLen) {
    const visible = toVisible(input);
    if (visible.length <= maxLen) return visible;
    return visible.slice(0, maxLen) + '...';
  }

  function listTerminalIds() {
    const nodeList = Array.from(
      document.querySelectorAll('.cy-floating-window-terminal[data-floating-window-id]')
    );
    const ids = nodeList
      .map((node) => node.getAttribute('data-floating-window-id'))
      .filter((id) => typeof id === 'string' && id.length > 0);
    return Array.from(new Set(ids));
  }

  function resolveTerminalId(explicitTerminalId) {
    if (explicitTerminalId) return explicitTerminalId;

    const known = listTerminalIds();
    if (known.includes(PREFERRED_TERMINAL_ID)) return PREFERRED_TERMINAL_ID;

    const active = document.querySelector(
      '.cy-floating-window-terminal.terminal-active[data-floating-window-id]'
    );
    const activeId = active?.getAttribute('data-floating-window-id');
    if (activeId) return activeId;

    const first = document.querySelector(
      '.cy-floating-window-terminal[data-floating-window-id]'
    );
    const firstId = first?.getAttribute('data-floating-window-id');
    if (firstId) return firstId;

    return known.length > 0 ? known[0] : null;
  }

  async function writeChars(terminalId, data, delayMs) {
    for (const ch of data) {
      await termApi.write(terminalId, ch);
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  async function sendLegacyPreamble(terminalId, options) {
    const escDelayMs = options?.escDelayMs ?? 100;
    const insertDelayMs = options?.insertDelayMs ?? 50;
    const charDelayMs = options?.charDelayMs ?? 5;

    await termApi.write(terminalId, '\x1b');
    await sleep(escDelayMs);
    await termApi.write(terminalId, '\x1b');
    await sleep(escDelayMs);
    await termApi.write(terminalId, 'i');
    await sleep(insertDelayMs);
    await termApi.write(terminalId, '\x15'); // Ctrl-U
    await sleep(charDelayMs);
  }

  function startOutputCapture(terminalId) {
    const chunks = [];
    const startedAt = Date.now();
    const unsubscribe = termApi.onData((id, data) => {
      if (id !== terminalId) return;
      chunks.push({ ts: Date.now(), data });
    });
    return {
      stop() {
        if (typeof unsubscribe === 'function') unsubscribe();
        const output = chunks.map((chunk) => chunk.data).join('');
        return {
          startedAt,
          endedAt: Date.now(),
          chunkCount: chunks.length,
          output,
          outputChars: output.length,
        };
      },
    };
  }

  async function probeSequence(options = {}) {
    const terminalId = resolveTerminalId(options.terminalId);
    if (!terminalId) {
      throw new Error('[enterProbe] Could not resolve terminalId. Pass options.terminalId explicitly.');
    }

    const mode = options.mode ?? 'raw'; // 'raw' | 'legacyPreamble'
    const text = options.text ?? '';
    const sequence = options.sequence ?? '\r';
    const charDelayMs = options.charDelayMs ?? 5;
    const dwellMs = options.dwellMs ?? 1800;
    const settleMsBefore = options.settleMsBefore ?? 150;

    const capture = startOutputCapture(terminalId);
    await sleep(settleMsBefore);

    if (mode === 'legacyPreamble') {
      await sendLegacyPreamble(terminalId, options);
    }

    if (text.length > 0) {
      await writeChars(terminalId, text, charDelayMs);
    }

    await writeChars(terminalId, sequence, charDelayMs);
    await sleep(dwellMs);

    const captured = capture.stop();
    return {
      terminalId,
      mode,
      text,
      sequence,
      sequenceHex: toHex(sequence),
      sequenceVisible: toVisible(sequence),
      outputChars: captured.outputChars,
      outputChunkCount: captured.chunkCount,
      outputTailVisible: compactVisible(captured.output.slice(-500), 800),
      rawOutput: captured.output,
      startedAt: captured.startedAt,
      endedAt: captured.endedAt,
      elapsedMs: captured.endedAt - captured.startedAt,
    };
  }

  async function sweep(options = {}) {
    const terminalId = resolveTerminalId(options.terminalId);
    if (!terminalId) {
      throw new Error('[enterProbe] Could not resolve terminalId. Open a terminal or pass terminalId.');
    }

    const modes = options.modes ?? ['raw', 'legacyPreamble'];
    const candidates = options.candidates ?? DEFAULT_CANDIDATES;
    const textBase = options.text ?? 'enter-probe';
    const trialPauseMs = options.trialPauseMs ?? 900;
    const runId = Date.now().toString(36);

    const results = [];
    for (const mode of modes) {
      for (const candidate of candidates) {
        const trialLabel = `${mode}/${candidate.name}`;
        const payload = `${textBase} [${runId}:${trialLabel}]`;
        console.log(
          `[enterProbe] trial=${trialLabel} terminal=${terminalId} sequenceHex=${toHex(candidate.sequence)}`
        );

        const result = await probeSequence({
          ...options,
          terminalId,
          mode,
          text: payload,
          sequence: candidate.sequence,
        });

        results.push({
          terminalId: result.terminalId,
          mode: result.mode,
          candidate: candidate.name,
          sequenceHex: result.sequenceHex,
          outputChars: result.outputChars,
          outputChunkCount: result.outputChunkCount,
          outputTailVisible: result.outputTailVisible,
          rawOutput: result.rawOutput,
        });
        await sleep(trialPauseMs);
      }
    }

    const table = results.map((row) => ({
      mode: row.mode,
      candidate: row.candidate,
      sequenceHex: row.sequenceHex,
      outputChars: row.outputChars,
      outputChunkCount: row.outputChunkCount,
      outputTailVisible: row.outputTailVisible,
    }));
    console.table(table);
    return results;
  }

  function installWriteSniffer(options = {}) {
    if (state.snifferInstalled) {
      console.warn('[enterProbe] write sniffer is already installed.');
      return { success: false, reason: 'already-installed' };
    }

    const terminalId = resolveTerminalId(options.terminalId);
    const includeAllTerminals = options.includeAllTerminals === true;
    const maxDataPreview = options.maxDataPreview ?? 120;

    try {
      const original = termApi.write.bind(termApi);
      termApi.write = async (targetTerminalId, data) => {
        const shouldLog =
          includeAllTerminals || !terminalId || targetTerminalId === terminalId;
        if (shouldLog) {
          console.log(
            '[enterProbe/write]',
            {
              terminalId: targetTerminalId,
              visible: compactVisible(data, maxDataPreview),
              hex: toHex(data),
              length: data.length,
            }
          );
        }
        return original(targetTerminalId, data);
      };
      state.originalWrite = original;
      state.snifferInstalled = true;
      console.log(
        `[enterProbe] write sniffer installed for terminal=${terminalId ?? 'ALL'} ` +
        `(includeAllTerminals=${includeAllTerminals})`
      );
      return { success: true, terminalId, includeAllTerminals };
    } catch (error) {
      console.error('[enterProbe] failed to install write sniffer:', error);
      return { success: false, reason: 'patch-failed', error: String(error) };
    }
  }

  function removeWriteSniffer() {
    if (!state.snifferInstalled) {
      return { success: true, alreadyRemoved: true };
    }
    if (state.originalWrite) {
      termApi.write = state.originalWrite;
    }
    state.originalWrite = null;
    state.snifferInstalled = false;
    console.log('[enterProbe] write sniffer removed.');
    return { success: true };
  }

  function help() {
    const lines = [
      'enterProbe API:',
      '- enterProbe.listTerminalIds()',
      '- enterProbe.resolveTerminalId([terminalId])',
      '- await enterProbe.probeSequence({ terminalId, mode, text, sequence, dwellMs })',
      '- await enterProbe.sweep({ terminalId, text, modes, candidates, dwellMs })',
      '- enterProbe.installWriteSniffer({ terminalId, includeAllTerminals })',
      '- enterProbe.removeWriteSniffer()',
      '',
      'Example:',
      'await enterProbe.sweep({',
      '  terminalId: enterProbe.resolveTerminalId("Anna"),',
      '  text: "enter probe: please reply OK",',
      '  modes: ["raw", "legacyPreamble"],',
      '  dwellMs: 2200',
      '})',
    ];
    console.log(lines.join('\n'));
  }

  root.enterProbe = {
    DEFAULT_CANDIDATES,
    listTerminalIds,
    resolveTerminalId,
    probeSequence,
    sweep,
    installWriteSniffer,
    removeWriteSniffer,
    toVisible,
    toHex,
    help,
  };

  console.log(
    '[enterProbe] installed. Run enterProbe.help() for usage. ' +
    `Detected terminals: ${JSON.stringify(listTerminalIds())}`
  );
})(window);
