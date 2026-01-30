import type { Token } from "@soniox/speech-to-text-web";

// Module-level state
let finalTokens: Token[] = [];
let nonFinalTokens: Token[] = [];
const listeners: Set<() => void> = new Set<() => void>();

/**
 * Called when voice SDK returns partial results.
 * Final tokens are accumulated, non-final tokens are replaced.
 */
export function onVoiceResult(result: { tokens: Token[] }): void {
    finalTokens.push(...result.tokens.filter(t => t.is_final));
    nonFinalTokens = result.tokens.filter(t => !t.is_final);
    notifyListeners();
}

/**
 * Append manually typed text as a final token.
 */
export function appendManualText(text: string): void {
    // Add newline before manual text if there are existing tokens
    if (finalTokens.length > 0) {
        finalTokens.push({
            text: "\n",
            is_final: true,
            speaker: undefined,
            language: undefined,
            confidence: 1.0,
        });
    }
    finalTokens.push({
        text,
        is_final: true,
        speaker: undefined,
        language: undefined,
        confidence: 1.0,
    });
    notifyListeners();
}

/**
 * Get all tokens for display (final + non-final).
 */
export function getDisplayTokens(): Token[] {
    return [...finalTokens, ...nonFinalTokens];
}

/**
 * Get total count of display tokens (for scroll detection).
 */
export function getDisplayTokenCount(): number {
    return finalTokens.length + nonFinalTokens.length;
}

/**
 * Get count of final tokens only.
 */
export function getFinalTokenCount(): number {
    return finalTokens.length;
}

/**
 * Get final tokens array (for sending to backend).
 */
export function getFinalTokens(): Token[] {
    return finalTokens;
}

/**
 * Reset all tokens (on new transcription session).
 */
export function reset(): void {
    finalTokens = [];
    nonFinalTokens = [];
    notifyListeners();
}

/**
 * Subscribe to store changes. Returns unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notifyListeners(): void {
    listeners.forEach(l => l());
}

// Expose store for e2e testing
if (typeof window !== 'undefined') {
    (window as unknown as { __TRANSCRIPTION_STORE__: {
        appendManualText: typeof appendManualText;
        reset: typeof reset;
        getDisplayTokenCount: typeof getDisplayTokenCount;
    } }).__TRANSCRIPTION_STORE__ = {
        appendManualText,
        reset,
        getDisplayTokenCount,
    };
}
