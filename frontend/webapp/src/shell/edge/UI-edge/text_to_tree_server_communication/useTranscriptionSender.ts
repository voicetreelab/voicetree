import { useState, useRef, useCallback, useEffect, type RefObject } from 'react';
import { type Token } from '@soniox/speech-to-text-web';
import {
  getFocusedFloatingWindow,
  getFocusedTarget,
  showTranscriptionPreview,
  updateTranscriptionPreview,
  hasActiveTranscriptionPreview,
  dismissTranscriptionPreview
} from "@/shell/edge/UI-edge/floating-windows/speech-to-focused";
import { subscribe as subscribeToStore, getFinalTokens } from "@/shell/edge/UI-edge/state/TranscriptionStore";

interface UseTranscriptionSenderOptions {
  endpoint: string;
}

interface UseTranscriptionSenderReturn {
  sendManualText: (text: string) => Promise<void>;
  bufferLength: number;
  isProcessing: boolean;
  connectionError: string | null;
  reset: () => void;
}

/**
 * Custom hook for sending transcription text incrementally to the backend.
 * Tracks what has been sent and only sends new text to avoid duplicates.
 *
 * When an editor/terminal is focused, shows a preview chip that updates live
 * as new tokens stream in. User can confirm (Enter) to insert or cancel (Escape).
 */
export function useTranscriptionSender({
  endpoint
}: UseTranscriptionSenderOptions): UseTranscriptionSenderReturn {
  // State
  const [bufferLength, setBufferLength] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Track what's been sent to server (doesn't trigger re-render)
  const sentTokensCount: RefObject<number> = useRef(0);
  const lastProcessedText: RefObject<string> = useRef("");

  // Track preview chip state
  const previewPromiseRef: RefObject<Promise<boolean> | null> = useRef(null);
  const previewStartTokenCount: RefObject<number> = useRef(0);
  const accumulatedPreviewText: RefObject<string> = useRef("");
  // Track if we've already sent to server on timeout (to avoid double-send)
  const sentToServerOnTimeoutRef: RefObject<boolean> = useRef(false);

  // Extract text from tokens (only final tokens)
  const getTranscriptText: (tokens: Token[]) => string = (tokens: Token[]): string => {
    return tokens
      .filter(token => token.text !== "<end>" && token.is_final === true)
      .map(token => token.text)
      .join("");
  };

  // Core sending function - sends directly to server (no preview logic)
  const sendToServer: (text: string, forceFlush?: boolean) => Promise<void> = useCallback(async (text: string, forceFlush: boolean = false): Promise<void> => {
    if (!text.trim()) return;

    setIsProcessing(true);

    try {
      const response: Response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, force_flush: forceFlush }),
      });

      if (response.ok) {
        const result: { buffer_length?: number } = await response.json();
        if (result.buffer_length !== undefined) {
          setBufferLength(result.buffer_length);
        }
        setConnectionError(null);
      } else {
        const errorMsg: string = `Server error: ${response.status} ${response.statusText}`;
        setConnectionError(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err) {
      console.error("Error sending to VoiceTree:", err);
      const errorMsg: string = err instanceof Error ? err.message : "Cannot connect to VoiceTree server";
      setConnectionError(errorMsg);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  }, [endpoint]);

  // Handle preview result - called when user confirms or cancels
  const handlePreviewResult: (inserted: boolean, focusedWindowType: string | null) => void = useCallback((inserted: boolean, focusedWindowType: string | null): void => {
    const textToProcess: string = accumulatedPreviewText.current;
    const alreadySentOnTimeout: boolean = sentToServerOnTimeoutRef.current;

    //console.log(`[TranscriptionSender] Preview result - focused: ${focusedWindowType ?? 'none'}, inserted: ${inserted}, alreadySent: ${alreadySentOnTimeout}, text length: ${textToProcess.length}`);

    if (inserted && focusedWindowType === 'editor') {
      // Text was inserted into editor - don't send to server
      // (if already sent on timeout, that's fine - it goes to both places)
    } else if (!inserted && !alreadySentOnTimeout) {
      // Cancelled and not yet sent - send to server
      if (textToProcess.trim()) {
        void sendToServer(textToProcess, false);
      }
    }
    // For terminal: text was inserted AND we send to server (handled separately)

    // Reset preview state
    previewPromiseRef.current = null;
    accumulatedPreviewText.current = "";
    sentToServerOnTimeoutRef.current = false;
  }, [sendToServer]);

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

    // Check if there's a focused editor/terminal
    const focusedWindow: { type: 'editor' | 'terminal'; id: string } | null = getFocusedFloatingWindow();
    const focusedTarget: ReturnType<typeof getFocusedTarget> = getFocusedTarget();

    if (focusedTarget) {
      // Accumulate text for preview
      accumulatedPreviewText.current += newText;

      if (hasActiveTranscriptionPreview()) {
        // Update existing preview chip with accumulated text
        updateTranscriptionPreview(accumulatedPreviewText.current);
      } else {
        // Create new preview chip
        previewStartTokenCount.current = sentTokensCount.current;
        const windowType: string | null = focusedWindow?.type ?? null;

        // onTimeout callback: send to server after 15s but keep chip visible
        const onTimeout: () => void = (): void => {
          const textToSend: string = accumulatedPreviewText.current;
          if (textToSend.trim() && !sentToServerOnTimeoutRef.current) {
            sentToServerOnTimeoutRef.current = true;
            void sendToServer(textToSend, false);
            //console.log(`[TranscriptionSender] Timeout - sent to server, chip stays visible for user to insert`);
          }
        };

        previewPromiseRef.current = showTranscriptionPreview(accumulatedPreviewText.current, focusedTarget, { onTimeout });

        // Handle the result when user confirms/cancels (non-blocking)
        previewPromiseRef.current.then((inserted: boolean) => {
          handlePreviewResult(inserted, windowType);
        }).catch(() => {
          // Preview was cancelled/errored - reset state
          previewPromiseRef.current = null;
          accumulatedPreviewText.current = "";
          sentToServerOnTimeoutRef.current = false;
        });
      }

      // Mark tokens as handled (preview will deal with them)
      sentTokensCount.current = finalTokensOnly.length;
      return;
    }

    // Send to server only if no chip is shown
    try {
      await sendToServer(newText, false);
      sentTokensCount.current = finalTokensOnly.length;
    } catch (err) {
      console.error('Failed to send incremental tokens, will retry:', err);
    }
  }, [sendToServer, handlePreviewResult]);

  // Send manual text (doesn't use token tracking)
  // Uses force_flush=true to trigger immediate processing (Enter key behavior)
  const sendManualText: (text: string) => Promise<void> = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return;

    // Dismiss any active preview first
    if (hasActiveTranscriptionPreview()) {
      dismissTranscriptionPreview();
    }

    try {
      // Pass forceFlush=true for manual text submission (Enter key)
      // This bypasses the buffer threshold on the server
      await sendToServer(text, true);
      lastProcessedText.current = text;
    } catch (err) {
      console.error('Failed to send manual text:', err);
    }
  }, [sendToServer]);

  // Reset tracking (e.g., when starting new session)
  const reset: () => void = useCallback(() => {
    sentTokensCount.current = 0;
    lastProcessedText.current = "";
    previewPromiseRef.current = null;
    previewStartTokenCount.current = 0;
    accumulatedPreviewText.current = "";
    sentToServerOnTimeoutRef.current = false;
    setBufferLength(0);
    setConnectionError(null);

    // Dismiss any active preview
    if (hasActiveTranscriptionPreview()) {
      dismissTranscriptionPreview();
    }
  }, []);

  // Subscribe to TranscriptionStore and auto-send new final tokens
  useEffect(() => {
    const unsubscribe: () => void = subscribeToStore(() => {
      const finalTokens: Token[] = getFinalTokens();
      if (finalTokens.length > sentTokensCount.current) {
        void sendIncrementalTokens(finalTokens);
      }
    });
    return unsubscribe;
  }, [sendIncrementalTokens]);

  return {
    sendManualText,
    bufferLength,
    isProcessing,
    connectionError,
    reset,
  };
}