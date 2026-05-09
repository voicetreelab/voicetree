import { describe, expect, it } from 'vitest';
import { detectPromptShape, type LineSnapshot, type PromptDetectionResult } from '../prompts';

function snapshot(opts: {
    line?: string;
    trailing?: readonly string[];
    altScreen?: boolean;
    cursorRow?: number;
    cursorCol?: number;
}): LineSnapshot {
    const trailing: readonly string[] = opts.trailing ?? (opts.line ? [opts.line] : []);
    return {
        currentLine: opts.line ?? trailing[trailing.length - 1] ?? '',
        trailingLines: trailing,
        cursorRow: opts.cursorRow ?? trailing.length - 1,
        cursorCol: opts.cursorCol ?? (opts.line?.length ?? 0),
        altScreenActive: opts.altScreen ?? false,
    };
}

describe('detectPromptShape — agent prompts (awaiting)', () => {
    describe('Claude Code permission box (multi-line)', () => {
        it('detects Claude Code permission box with question + choices', () => {
            const result: PromptDetectionResult = detectPromptShape(snapshot({
                trailing: [
                    '╭──────────────────────────────────────────────╮',
                    '│ Bash command                                 │',
                    '│   git push origin main                       │',
                    '│ Run this command?                            │',
                    '│ ❯ 1. Yes                                     │',
                    '│   2. Yes, and don\'t ask again for git push   │',
                    '│   3. No                                      │',
                    '╰──────────────────────────────────────────────╯',
                ],
            }));
            expect(result.type).toBe('awaiting');
            if (result.type === 'awaiting') {
                expect(result.patternId).toBe('numbered_choice_arrow');
                expect(result.confidence).toBe('high');
            }
        });

        it('detects "Do you want to" + numbered choice', () => {
            const result: PromptDetectionResult = detectPromptShape(snapshot({
                trailing: [
                    'Do you want to proceed?',
                    '❯ 1. Yes',
                    '  2. No',
                ],
            }));
            expect(result.type).toBe('awaiting');
        });

        it('detects "Allow this" question', () => {
            const result: PromptDetectionResult = detectPromptShape(snapshot({
                trailing: [
                    'Allow this tool to modify files?',
                    '❯ 1. Allow',
                    '  2. Deny',
                ],
            }));
            expect(result.type).toBe('awaiting');
        });
    });

    describe('Y/N prompts', () => {
        it('detects (y/n) at end of line', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Continue with the migration? (y/n)' }));
            expect(r.type).toBe('awaiting');
            if (r.type === 'awaiting') expect(r.patternId).toBe('yn_paren');
        });

        it('detects [Y/n] (capitalised default-yes)', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Apply changes? [Y/n]' }));
            expect(r.type).toBe('awaiting');
            if (r.type === 'awaiting') expect(r.patternId).toBe('yn_bracket');
        });

        it('detects [y/N] (default-no)', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Are you sure? [y/N]' }));
            expect(r.type).toBe('awaiting');
        });

        it('detects (yes/no)', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Confirm? (yes/no): ' }));
            expect(r.type).toBe('awaiting');
        });
    });

    describe('Password prompts', () => {
        it('detects "Password:"', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Password: ' }));
            expect(r.type).toBe('awaiting');
            if (r.type === 'awaiting') expect(r.patternId).toBe('password_prompt');
        });

        it('detects "Enter passphrase:"', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Enter passphrase: ' }));
            expect(r.type).toBe('awaiting');
        });

        it('case-insensitive', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'PASSWORD:' }));
            expect(r.type).toBe('awaiting');
        });
    });

    describe('Generic question fallback', () => {
        it('detects question ending with ?', () => {
            const r: PromptDetectionResult = detectPromptShape(snapshot({
                line: 'What database name should we use?',
            }));
            expect(r.type).toBe('awaiting');
            if (r.type === 'awaiting') expect(r.confidence).toBe('medium');
        });

        it('does not match a single-character question (too short)', () => {
            // Short questions are noise — '?' alone doesn't mean the agent is awaiting.
            const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Hi?' }));
            expect(r.type).toBe('none');
        });
    });
});

describe('detectPromptShape — TUI alt-screen', () => {
    it('alt-screen active → awaiting regardless of pattern', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({
            line: 'completely unrelated content',
            altScreen: true,
        }));
        expect(r.type).toBe('awaiting');
        if (r.type === 'awaiting') expect(r.patternId).toBe('tui_alt_screen');
    });

    it('alt-screen wins over shell-prompt pattern', () => {
        // If a TUI somehow renders text that looks like a shell prompt, alt-screen still wins.
        const r: PromptDetectionResult = detectPromptShape(snapshot({
            line: 'user@host % ',
            altScreen: true,
        }));
        expect(r.type).toBe('awaiting');
    });
});

describe('detectPromptShape — shell idle (no event)', () => {
    it('zsh % prompt', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'lochlan@mac voicetree % ' }));
        expect(r.type).toBe('shell_idle');
    });

    it('bash $ prompt', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'user@host:~/code$ ' }));
        expect(r.type).toBe('shell_idle');
    });

    it('root # prompt', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'root@machine:/etc# ' }));
        expect(r.type).toBe('shell_idle');
    });

    it('powerlevel10k ❯ prompt', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: '~/voicetree ❯ ' }));
        expect(r.type).toBe('shell_idle');
    });

    it('aider chat prompt', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'aider> ' }));
        expect(r.type).toBe('shell_idle');
        if (r.type === 'shell_idle') expect(r.patternId).toBe('aider_prompt');
    });

    it('aider:CHAT> prompt', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'aider:CHAT> ' }));
        expect(r.type).toBe('shell_idle');
    });
});

describe('detectPromptShape — false-positive avoidance', () => {
    it('agent narrative quoting a question is NOT awaiting', () => {
        // Pattern: the agent describes what it WOULD ask, mid-explanation.
        // The narrative ends with text after the question, NOT with the question itself.
        const r: PromptDetectionResult = detectPromptShape(snapshot({
            line: 'The user might wonder, "What database should we use?", but we already decided.',
        }));
        // Generic-? regex requires the line to end with `?`. This one doesn't.
        expect(r.type).toBe('none');
    });

    it('shell prompt overrides generic-? if both could match', () => {
        // If somehow a shell prompt has a `?` glyph in the user prefix, it should still
        // resolve to shell_idle (higher priority) instead of awaiting.
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'user@h?st:~ $ ' }));
        // The shell pattern wins at priority 60, generic-? at 30.
        expect(r.type).toBe('shell_idle');
    });

    it('Y/N pattern beats shell pattern when both could match', () => {
        // Genuine question with Y/N at end takes precedence over a passing shell pattern.
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Continue? (y/n)' }));
        expect(r.type).toBe('awaiting');
    });

    it('empty buffer yields none', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: '' }));
        expect(r.type).toBe('none');
    });

    it('plain output line yields none', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({
            line: 'Building project... 42 files compiled successfully.',
        }));
        expect(r.type).toBe('none');
    });
});

describe('detectPromptShape — priority ordering', () => {
    it('high-confidence Y/N beats medium generic-?', () => {
        // Both could match. High priority Y/N should win.
        const r: PromptDetectionResult = detectPromptShape(snapshot({ line: 'Are you ready? (y/n)' }));
        expect(r.type).toBe('awaiting');
        if (r.type === 'awaiting') {
            expect(r.confidence).toBe('high');
            expect(r.patternId).toBe('yn_paren');
        }
    });

    it('numbered choice beats box question (specificity)', () => {
        const r: PromptDetectionResult = detectPromptShape(snapshot({
            trailing: [
                'Run this command?',
                '❯ 1. Yes',
                '  2. No',
            ],
        }));
        expect(r.type).toBe('awaiting');
        if (r.type === 'awaiting') expect(r.patternId).toBe('numbered_choice_arrow');
    });
});
