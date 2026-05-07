import { describe, it, expect } from 'vitest';
import { parseClaudeUsageText } from './parseClaudeUsageText';

// Captured from a real `claude` PTY scrape of `/usage`. Includes the ANSI
// escape sequences, cursor positioning, and partial repaints that the
// terminal emits — the parser has to be robust to all of it.
const REAL_USAGE_OUTPUT: string = [
  '\x1b[H\x1b[1B\x1b[38;2;215;119;87m ▐\x1b[48;2;0;0;0m▛███▜\x1b[49m▌\x1b[3C\x1b[39m\x1b[1mClaude Code\x1b[1C\x1b[22m\x1b[38;2;153;153;153mv2.1.132',
  '\x1b[1B\x1b[38;2;215;119;87m▝▜\x1b[48;2;0;0;0m█████\x1b[49m▛▘\x1b[2C\x1b[38;2;153;153;153mOpus 4.7 (1M context) · Claude Max',
  '\x1b[1B\x1b[1mCurrent session\x1b[3C\x1b[1B\x1b[22m\x1b[48;2;69;92;115m\x1b[38;2;153;204;255m████                                              \x1b[1C\x1b[39m\x1b[49m9%\x1b[1Cused',
  '\x1b[1B\x1b[38;2;153;153;153mResets 2:10am (Australia/Sydney)\x1b[3C',
  '\x1b[1B\x1b[1mCurrent week (all models)\x1b[3C\x1b[1B\x1b[22m\x1b[48;2;69;92;115m\x1b[38;2;153;204;255m█████████████████████                             \x1b[1C\x1b[39m\x1b[49m43%\x1b[1Cused',
  '\x1b[1B\x1b[38;2;153;153;153mResets May 9 at 6am (Australia/Sydney)\x1b[3C',
  '\x1b[1B\x1b[1mCurrent week (Sonnet only)\x1b[3C\x1b[1B\x1b[22m\x1b[48;2;69;92;115m\x1b[38;2;153;204;255m█                                                 \x1b[1C\x1b[39m\x1b[49m2%\x1b[1Cused',
  '\x1b[1B\x1b[38;2;153;153;153mResets May 9 at 6am (Australia/Sydney)\x1b[3C',
].join('');

describe('parseClaudeUsageText', () => {
  it('extracts plan, percentages, and reset times from real /usage output', () => {
    const parsed = parseClaudeUsageText(REAL_USAGE_OUTPUT);

    expect(parsed.planType).toBe('Claude Max');

    expect(parsed.currentSession).toEqual({
      usedPercent: 9,
      resetsAt: '2:10am (Australia/Sydney)',
    });
    expect(parsed.currentWeek).toEqual({
      usedPercent: 43,
      resetsAt: 'May 9 at 6am (Australia/Sydney)',
    });
    expect(parsed.currentWeekSonnet).toEqual({
      usedPercent: 2,
      resetsAt: 'May 9 at 6am (Australia/Sydney)',
    });
  });

  it('returns nulls when the panel never rendered', () => {
    const parsed = parseClaudeUsageText('You are currently using your subscription to power your Claude Code usage');
    expect(parsed.currentSession).toBeNull();
    expect(parsed.currentWeek).toBeNull();
    expect(parsed.currentWeekSonnet).toBeNull();
    expect(parsed.planType).toBeNull();
  });

  it('handles a Pro plan label', () => {
    const parsed = parseClaudeUsageText('Opus 4.7 · Claude Pro\n\nCurrent session\n5% used\nResets 1am (UTC)');
    expect(parsed.planType).toBe('Claude Pro');
    expect(parsed.currentSession?.usedPercent).toBe(5);
    expect(parsed.currentSession?.resetsAt).toBe('1am (UTC)');
  });

  it('does not let resetsAt run past the section', () => {
    const parsed = parseClaudeUsageText(
      'Current session 12% used Resets 2:10am (Australia/Sydney) Current week (all models) 44% used Resets May 9 at 6am (Australia/Sydney)',
    );
    expect(parsed.currentSession?.resetsAt).toBe('2:10am (Australia/Sydney)');
    expect(parsed.currentWeek?.resetsAt).toBe('May 9 at 6am (Australia/Sydney)');
  });
});
