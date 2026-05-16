import { readFile } from 'node:fs/promises';

const logPath = process.argv[2];
if (!logPath) throw new Error('usage: node scripts/check6_sanitizer.mjs EVIDENCE/check6_nodepty_attach.log');

/* eslint-disable no-control-regex */
const OSC_PATTERN = /\x1B\][^\x07\x1B\n]*(?:\x07|\x1B\\)?/g;
const DCS_PATTERN = /\x1B[PX^_][^\x1B\n]*(?:\x1B\\)?/g;
const CSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const ESC2_PATTERN = /\x1B[@-Z\\-_]/g;
const C1_PATTERN = /[\x80-\x9F]/g;
/* eslint-enable no-control-regex */

function sanitize(data, { collapseMultiCR = false } = {}) {
  let cleaned = data;
  cleaned = cleaned.replace(OSC_PATTERN, '');
  cleaned = cleaned.replace(DCS_PATTERN, '');
  cleaned = cleaned.replace(CSI_PATTERN, '');
  cleaned = cleaned.replace(ESC2_PATTERN, '');
  cleaned = cleaned.replace(C1_PATTERN, '');
  if (collapseMultiCR) cleaned = cleaned.replace(/\r+\n/g, '\n');
  cleaned = cleaned.replace(/\r\n/g, '\n');
  const crLines = cleaned.split('\n');
  cleaned = crLines
    .map((line) => {
      const parts = line.split('\r');
      return parts[parts.length - 1];
    })
    .join('\n');
  let result = '';
  for (let i = 0; i < cleaned.length; i += 1) {
    const code = cleaned.charCodeAt(i);
    if (code === 10 || (code >= 32 && code <= 126)) result += cleaned[i];
  }
  return result;
}

const rawText = await readFile(logPath, 'utf8');
const unpatchedText = sanitize(rawText).replace(/\n{3,}/g, '\n\n');
const patchedText = sanitize(rawText, { collapseMultiCR: true }).replace(/\n{3,}/g, '\n\n');
const unpatched = unpatchedText.replace(/\n/g, '').length;
const patched = patchedText.replace(/\n/g, '').length;
const drift_pct = unpatched === 0 ? 100 : (Math.abs(unpatched - patched) / unpatched) * 100;

console.log(
  JSON.stringify({
    raw_chars: rawText.length,
    unpatched,
    patched,
    drift_pct: Number(drift_pct.toFixed(3)),
    unpatched_sample: unpatchedText.slice(-300),
    patched_sample: patchedText.slice(-300)
  })
);
