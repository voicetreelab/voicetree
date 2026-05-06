/**
 * Headless terminal emulator wrapping `@xterm/headless`.
 *
 * Bytes from a PTY are written into the emulator; the emulator interprets
 * ANSI escape sequences (cursor moves, color codes, alt-screen toggles,
 * line clears) the same way a real terminal renderer would. We then read
 * a structured `LineSnapshot` for the pure prompt detector to classify.
 *
 * This is the *edge* of the prompt-detection pipeline. The pure detector
 * (prompts.ts) consumes the snapshot.
 */

import { Terminal } from '@xterm/headless';
import type { LineSnapshot } from './prompts';

export type Emulator = {
    /**
     * Feed PTY bytes into the emulator. Returns a Promise that resolves when
     * the bytes have been parsed and the buffer is updated. Callers must
     * await before reading `getSnapshot()` to see the effects.
     */
    readonly write: (bytes: string | Uint8Array) => Promise<void>;
    /** Read a snapshot reflecting current visible state. */
    readonly getSnapshot: () => LineSnapshot;
    /** Free underlying resources. Call on terminal exit. */
    readonly dispose: () => void;
};

export type EmulatorOptions = {
    readonly rows?: number;
    readonly cols?: number;
    /** Number of trailing lines to capture in the snapshot. Default 8. */
    readonly snapshotLines?: number;
};

const DEFAULT_ROWS: number = 40;
const DEFAULT_COLS: number = 200;
const DEFAULT_SNAPSHOT_LINES: number = 8;

export function createEmulator(opts: EmulatorOptions = {}): Emulator {
    const term: Terminal = new Terminal({
        rows: opts.rows ?? DEFAULT_ROWS,
        cols: opts.cols ?? DEFAULT_COLS,
        allowProposedApi: true,
        // We never see this terminal — disable bell, scrollback minimal.
        scrollback: 100,
    });

    const snapshotLines: number = opts.snapshotLines ?? DEFAULT_SNAPSHOT_LINES;

    return {
        write(bytes: string | Uint8Array): Promise<void> {
            return new Promise<void>((resolve: () => void) => {
                term.write(bytes, resolve);
            });
        },

        getSnapshot(): LineSnapshot {
            const buf = term.buffer.active;
            const cursorRow: number = buf.cursorY + buf.viewportY;
            const cursorCol: number = buf.cursorX;
            const altScreenActive: boolean = buf.type === 'alternate';

            // Read up to `snapshotLines` lines ending at the cursor row.
            const startY: number = Math.max(0, cursorRow - snapshotLines + 1);
            const trailing: string[] = [];
            for (let y: number = startY; y <= cursorRow; y++) {
                const line = buf.getLine(y);
                if (!line) continue;
                // trimRight=true drops trailing whitespace; the shape detector
                // doesn't need it and trailing spaces are common in box-drawn UIs.
                trailing.push(line.translateToString(true));
            }

            // currentLine = last non-empty trailing line.
            let currentLine: string = '';
            for (let i: number = trailing.length - 1; i >= 0; i--) {
                if (trailing[i].length > 0) {
                    currentLine = trailing[i];
                    break;
                }
            }

            return {
                currentLine,
                trailingLines: trailing,
                cursorRow,
                cursorCol,
                altScreenActive,
            };
        },

        dispose(): void {
            term.dispose();
        },
    };
}
