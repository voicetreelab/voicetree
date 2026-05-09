/**
 * Black-box tests for the @xterm/headless wrapper.
 *
 * Strategy: feed real PTY-shaped byte sequences and assert the resulting
 * snapshot. Never mocks the emulator — exercises the real terminal state
 * machine end-to-end.
 *
 * Note: `write` is async; tests await each call before reading the snapshot.
 */

import { describe, expect, it } from 'vitest';
import { createEmulator } from '../emulator';
import { detectPromptShape } from '../prompts';

describe('createEmulator — basic byte processing', () => {
    it('accumulates plain text into currentLine', async () => {
        const emu = createEmulator();
        await emu.write('hello world');
        const snap = emu.getSnapshot();
        expect(snap.currentLine).toBe('hello world');
    });

    it('newline advances to a new line', async () => {
        const emu = createEmulator();
        await emu.write('line one\r\nline two');
        const snap = emu.getSnapshot();
        expect(snap.currentLine).toBe('line two');
        expect(snap.trailingLines).toContain('line one');
    });

    it('strips ANSI color escapes from snapshot text', async () => {
        const emu = createEmulator();
        await emu.write('\x1b[31mred text\x1b[0m');
        const snap = emu.getSnapshot();
        expect(snap.currentLine).toBe('red text');
        expect(snap.currentLine).not.toContain('\x1b');
    });

    it('cursor up + line clear rewrites the visible line', async () => {
        const emu = createEmulator();
        await emu.write('first version\r\n');
        await emu.write('\x1b[A\x1b[2K\rsecond version');
        const snap = emu.getSnapshot();
        expect(snap.currentLine).toBe('second version');
    });
});

describe('createEmulator — alt-screen detection', () => {
    it('detects alt-screen mode after \\e[?1049h', async () => {
        const emu = createEmulator();
        await emu.write('\x1b[?1049h');
        await emu.write('TUI content');
        expect(emu.getSnapshot().altScreenActive).toBe(true);
    });

    it('returns to normal screen after \\e[?1049l', async () => {
        const emu = createEmulator();
        await emu.write('\x1b[?1049h');
        expect(emu.getSnapshot().altScreenActive).toBe(true);
        await emu.write('\x1b[?1049l');
        expect(emu.getSnapshot().altScreenActive).toBe(false);
    });
});

describe('createEmulator → detectPromptShape end-to-end', () => {
    it('Y/N prompt rendered into emulator → detected as awaiting', async () => {
        const emu = createEmulator();
        await emu.write('Building project...\r\n');
        await emu.write('Continue? (y/n) ');
        const result = detectPromptShape(emu.getSnapshot());
        expect(result.type).toBe('awaiting');
    });

    it('shell prompt with cwd → detected as shell_idle', async () => {
        const emu = createEmulator();
        await emu.write('lochlan@mac voicetree % ');
        const result = detectPromptShape(emu.getSnapshot());
        expect(result.type).toBe('shell_idle');
    });

    it('mid-output streaming → none', async () => {
        const emu = createEmulator();
        await emu.write('Compiling sources...\r\n42 of 100');
        const result = detectPromptShape(emu.getSnapshot());
        expect(result.type).toBe('none');
    });

    it('alt-screen TUI → awaiting via emulator state', async () => {
        const emu = createEmulator();
        await emu.write('\x1b[?1049h\x1b[2J');
        await emu.write('vim-like UI rendered here');
        const result = detectPromptShape(emu.getSnapshot());
        expect(result.type).toBe('awaiting');
        if (result.type === 'awaiting') expect(result.patternId).toBe('tui_alt_screen');
    });

    it('Claude-Code-style boxed permission UI → detected as awaiting', async () => {
        const emu = createEmulator({ cols: 80 });
        await emu.write('Some prior output\r\n');
        await emu.write('╭──────────────────────────────────────────────╮\r\n');
        await emu.write('│ Bash command                                 │\r\n');
        await emu.write('│   git push origin main                       │\r\n');
        await emu.write('│                                              │\r\n');
        await emu.write('│ Run this command?                            │\r\n');
        await emu.write('│ ❯ 1. Yes                                     │\r\n');
        await emu.write('│   2. Yes, and don\'t ask again for git push   │\r\n');
        await emu.write('│   3. No                                      │\r\n');
        await emu.write('╰──────────────────────────────────────────────╯');
        const result = detectPromptShape(emu.getSnapshot());
        expect(result.type).toBe('awaiting');
    });
});

describe('createEmulator — disposal', () => {
    it('does not throw on dispose', async () => {
        const emu = createEmulator();
        await emu.write('some content');
        expect(() => emu.dispose()).not.toThrow();
    });
});
