import { useState, useRef, useCallback, type RefObject } from 'react';
import { type Token } from '@soniox/speech-to-text-web';

interface UseTranscriptionSenderOptions {
  endpoint: string;
}

interface UseTranscriptionSenderReturn {
  sendIncrementalTokens: (tokens: Token[]) => Promise<void>;
  sendManualText: (text: string) => Promise<void>;
  bufferLength: number;
  isProcessing: boolean;
  connectionError: string | null;
  reset: () => void;
}

/**
 * Custom hook for sending transcription text incrementally to the backend.
 * Tracks what has been sent and only sends new text to avoid duplicates.
 */
export function useTranscriptionSender({
  endpoint
}: UseTranscriptionSenderOptions): UseTranscriptionSenderReturn {
  // State
  const [bufferLength, setBufferLength] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Track what's been sent (doesn't trigger re-render)
  const sentTokensCount: RefObject<number> = useRef(0);
  const lastProcessedText: RefObject<string> = useRef("");

  // Extract text from tokens (only final tokens)
  const getTranscriptText: (tokens: Token[]) => string = (tokens: Token[]): string => {
    return tokens
      .filter(token => token.text !== "<end>" && token.is_final === true)
      .map(token => token.text)
      .join("");
  };

  // Core sending function
  const sendToBackend: (text: string, skipDuplicateCheck?: boolean) => Promise<void> = useCallback(async (text: string, skipDuplicateCheck: boolean = false): Promise<void> => {
    if (!text.trim()) return;

    // Avoid sending the same text twice (only for manual text)
    if (!skipDuplicateCheck && text === lastProcessedText.current) {
      return;
    }

    setIsProcessing(true);

    try {

      const response: Response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const result: { buffer_length?: number } = await response.json();
        if (result.buffer_length !== undefined) {
          setBufferLength(result.buffer_length);
        }
        setConnectionError(null);
        if (!skipDuplicateCheck) {
          lastProcessedText.current = text;
        }
      } else {
        const errorMsg: string = `Server error: ${response.status} ${response.statusText}`;
        setConnectionError(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err) {
      console.error("Error sending to VoiceTree:", err);
      const errorMsg: string = err instanceof Error ? err.message : "Cannot connect to VoiceTree server";
      setConnectionError(errorMsg);
      throw err; // Re-throw to allow caller to handle
    } finally {
      setIsProcessing(false);
    }
  }, [endpoint]);

  // Send only NEW FINAL tokens incrementally
  const sendIncrementalTokens: (tokens: Token[]) => Promise<void> = useCallback(async (tokens: Token[]): Promise<void> => {
    // Filter to ensure we only work with final tokens
    const finalTokensOnly: Token[] = tokens.filter(token => token.is_final === true);

    // Only process tokens that we haven't sent yet
    const newTokens: Token[] = finalTokensOnly.slice(sentTokensCount.current);

    if (newTokens.length === 0) {
      return;
    }

    // Convert only the new tokens to text
    const newText: string = getTranscriptText(newTokens);

    if (!newText.trim()) {
      // Update count even if text is empty (to avoid reprocessing)
      sentTokensCount.current = finalTokensOnly.length;
      return;
    }

    try {
      // Skip duplicate check for incremental tokens - they're already tracked by sentTokensCount
      await sendToBackend(newText, true);
      // Only update the count after successful send (track final tokens only)
      sentTokensCount.current = finalTokensOnly.length;
    } catch (err) {
      // Don't update sentTokensCount on error, so we retry next time
      console.error('Failed to send incremental tokens, will retry:', err);
    }
  }, [sendToBackend]);

  // Send manual text (doesn't use token tracking)
  const sendManualText: (text: string) => Promise<void> = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return;

    try {
      await sendToBackend(text);
    } catch (err) {
      console.error('Failed to send manual text:', err);
    }
  }, [sendToBackend]);

  // Reset tracking (e.g., when starting new session)
  const reset: () => void = useCallback(() => {
    sentTokensCount.current = 0;
    lastProcessedText.current = "";
    setBufferLength(0);
    setConnectionError(null);
  }, []);

  return {
    sendIncrementalTokens,
    sendManualText,
    bufferLength,
    isProcessing,
    connectionError,
    reset,
  };
}