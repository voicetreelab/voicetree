/**
 * Pure prompt-shape detector — Tier 3 of the awaiting-input detection stack.
 *
 * Takes a terminal snapshot (last few visible lines + cursor + alt-screen flag)
 * and a pattern catalog, returns a classification:
 *
 *   - 'awaiting'   → an agent is asking the user something. Emit prompt_detected.
 *   - 'shell_idle' → a shell is at its prompt waiting for the next command.
 *                    Treated as IDLE, not awaiting — don't emit prompt_detected.
 *   - 'none'       → no recognizable prompt pattern.
 *
 * Quiescence and cursor-stability are enforced by the *caller* (the prompt
 * runner). This function has no notion of time — it just classifies a
 * snapshot. Pure: same input → same output, no I/O.
 */

export type LineSnapshot = {
    /** The last non-empty line on screen. Most patterns match against this. */
    readonly currentLine: string;
    /** Last N lines including currentLine. Multi-line patterns (Claude Code box UI) need this. */
    readonly trailingLines: readonly string[];
    /** Cursor position. Mostly used by the runner for stability checks; detector reads it for end-of-line confidence. */
    readonly cursorRow: number;
    readonly cursorCol: number;
    /**
     * Alt-screen buffer is active. True for full-screen TUI apps (vim, lazygit,
     * helix, btop). Such apps "always await" while quiescent; we mark them
     * 'awaiting' regardless of pattern matches.
     */
    readonly altScreenActive: boolean;
};

export type PromptKind =
    /** An agent is blocking on user input — emit prompt_detected. */
    | 'awaiting'
    /** A shell is sitting at its prompt — do not emit prompt_detected. */
    | 'shell_idle';

export type PromptPattern = {
    readonly id: string;
    readonly kind: PromptKind;
    /** Higher-priority patterns are tested first. Range: 0..100. */
    readonly priority: number;
    /** Confidence label. 'high' patterns trigger immediately; 'medium' may want extra quiescence. */
    readonly confidence: 'high' | 'medium';
    /**
     * Returns true if this pattern matches the snapshot.
     * Implementations should be cheap — the runner calls these on every
     * detection tick.
     */
    readonly matches: (snapshot: LineSnapshot) => boolean;
};

export type PromptDetectionResult =
    | { readonly type: 'awaiting'; readonly patternId: string; readonly confidence: 'high' | 'medium' }
    | { readonly type: 'shell_idle'; readonly patternId: string }
    | { readonly type: 'none' };

// =============================================================================
// Pattern catalogue — order does not matter, sorted by priority on use.
// =============================================================================

// Numbered choice with arrow indicator. Allows leading whitespace OR box-drawing
// pipe chars (│┃|) so Claude Code's `│ ❯ 1. Yes ... │` boxed UI matches.
// The `>` alternative requires box/whitespace before it (not bare in-line `>`)
// to avoid matching shell redirects like `cmd > 2.txt`.
const RE_NUMBERED_CHOICE: RegExp = /^[│┃|\s]*[❯>]\s*\d+\.\s+\S/;
const RE_BOX_QUESTION: RegExp = /\b(do you want to|allow this|run this command|approve|continue)\b\??/i;
const RE_YN: RegExp = /\(\s*[yY](es)?\s*[/|]\s*[nN](o)?\s*\)\s*[:?]?\s*$/;
const RE_YN_BRACKET: RegExp = /\[\s*[yY](es)?\s*[/|]\s*[nN](o)?\s*\]\s*[:?]?\s*$/;
const RE_PASSWORD: RegExp = /\b(password|passphrase)\b\s*:\s*$/i;
const RE_AIDER_PROMPT: RegExp = /(^|\s)aider[:>]\s*$/;
// Shell prompts — match common terminator characters at end of line, after some text.
// Includes: $ # % > ❯ › ▸ → (one of these, optionally followed by trailing whitespace)
const RE_SHELL_PROMPT: RegExp = /[A-Za-z0-9_~/.\-)\]]\s*[\$#%>❯›▸→]\s*$/;
// Generic question fallback — line ends with ? after at least 8 chars of question text.
const RE_QUESTION: RegExp = /[A-Za-z][^?\n]{6,}\?\s*$/;

function createDefaultPromptPatterns(): readonly PromptPattern[] {
    return [
    // -------------------------------------------------------------------------
    // High confidence — agent is definitely blocking on the user
    // -------------------------------------------------------------------------
    {
        id: 'numbered_choice_arrow',
        kind: 'awaiting',
        priority: 95,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => {
            // Match against any of the trailing lines — the cursor often sits
            // beside the choice, not on the question line itself.
            return s.trailingLines.some(line => RE_NUMBERED_CHOICE.test(line));
        },
    },
    {
        id: 'box_question_with_choices',
        kind: 'awaiting',
        priority: 90,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => {
            // Claude Code permission boxes have the question on one line and
            // numbered choices on subsequent lines.
            const hasQuestion: boolean = s.trailingLines.some(line => RE_BOX_QUESTION.test(line));
            const hasChoice: boolean = s.trailingLines.some(line => RE_NUMBERED_CHOICE.test(line));
            return hasQuestion && hasChoice;
        },
    },
    {
        id: 'yn_paren',
        kind: 'awaiting',
        priority: 85,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => RE_YN.test(s.currentLine),
    },
    {
        id: 'yn_bracket',
        kind: 'awaiting',
        priority: 85,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => RE_YN_BRACKET.test(s.currentLine),
    },
    {
        id: 'password_prompt',
        kind: 'awaiting',
        priority: 80,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => RE_PASSWORD.test(s.currentLine),
    },

    // -------------------------------------------------------------------------
    // Shell-idle patterns — do not raise the alert; just suppress generic-?
    // matching from triggering on a quiet shell.
    // -------------------------------------------------------------------------
    {
        id: 'aider_prompt',
        kind: 'shell_idle',
        priority: 70,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => RE_AIDER_PROMPT.test(s.currentLine),
    },
    {
        id: 'shell_prompt',
        kind: 'shell_idle',
        priority: 60,
        confidence: 'high',
        matches: (s: LineSnapshot): boolean => RE_SHELL_PROMPT.test(s.currentLine),
    },

    // -------------------------------------------------------------------------
    // Medium confidence — generic question fallback. Lowest priority so the
    // shell-idle suppressors run first. Use only when nothing more specific hit.
    // -------------------------------------------------------------------------
    {
        id: 'generic_question_mark',
        kind: 'awaiting',
        priority: 30,
        confidence: 'medium',
        matches: (s: LineSnapshot): boolean => RE_QUESTION.test(s.currentLine),
    },
    ];
}

export const DEFAULT_PROMPT_PATTERNS: readonly PromptPattern[] = createDefaultPromptPatterns();

// =============================================================================
// Detector
// =============================================================================

/**
 * Classify a snapshot. Pure: no I/O, no time. Caller enforces quiescence
 * before treating an 'awaiting' result as actionable.
 */
export function detectPromptShape(
    snapshot: LineSnapshot,
    patterns: readonly PromptPattern[] = DEFAULT_PROMPT_PATTERNS,
): PromptDetectionResult {
    // Alt-screen TUIs (vim, lazygit, htop) are always "awaiting" while quiescent.
    // The runner's quiescence gate ensures we don't fire mid-update.
    if (snapshot.altScreenActive) {
        return { type: 'awaiting', patternId: 'tui_alt_screen', confidence: 'high' };
    }

    // Test patterns highest-priority first. First match wins.
    const sorted: readonly PromptPattern[] = [...patterns].sort((a, b) => b.priority - a.priority);
    for (const pattern of sorted) {
        if (pattern.matches(snapshot)) {
            if (pattern.kind === 'awaiting') {
                return { type: 'awaiting', patternId: pattern.id, confidence: pattern.confidence };
            }
            return { type: 'shell_idle', patternId: pattern.id };
        }
    }

    return { type: 'none' };
}
