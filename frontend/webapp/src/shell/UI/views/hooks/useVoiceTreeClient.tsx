import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  SonioxClient,
  type ErrorStatus,
  type RecorderState,
  type Token,
  type TranslationConfig,
} from "@soniox/speech-to-text-web";

interface UseVoiceTreeClientOptions {
  apiKey: string | (() => Promise<string>);
  translationConfig?: TranslationConfig;
  onStarted?: () => void;
  onFinished?: () => void;
  /** Optional callback for raw SDK partial results - use for forwarding to external stores */
  onPartialResult?: (result: { tokens: Token[] }) => void;
}

type TranscriptionError = {
  status: ErrorStatus;
  message: string;
  errorCode: number | undefined;
};

// useTranscribe hook wraps VoiceTree speech-to-text functionality using Soniox SDK.
export default function useVoiceTreeClient({
  apiKey,
  translationConfig,
  onStarted,
  onFinished,
  onPartialResult: onPartialResultCallback,
}: UseVoiceTreeClientOptions): {
  startTranscription: () => Promise<void>;
  stopTranscription: () => void;
  state: RecorderState;
  finalTokens: Token[];
  nonFinalTokens: Token[];
  error: TranscriptionError | null;
} {
  const sonioxClient: RefObject<SonioxClient | null> = useRef<SonioxClient | null>(null);

  sonioxClient.current ??= new SonioxClient({
    apiKey,
  });

  const [state, setState] = useState<RecorderState>("Init");
  const [finalTokens, setFinalTokens] = useState<Token[]>([]);
  const [nonFinalTokens, setNonFinalTokens] = useState<Token[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);

  const startTranscription: () => Promise<void> = useCallback(async () => {
    // Kill any existing client and create fresh one
    sonioxClient.current?.cancel();
    sonioxClient.current = new SonioxClient({ apiKey });

    setFinalTokens([]);
    setNonFinalTokens([]);
    setError(null);

    // First message we send contains configuration. Here we set if we set if we
    // are transcribing or translating. For translation we also set if it is
    // one-way or two-way.
    void sonioxClient.current.start({
      model: "stt-rt-preview",
      enableLanguageIdentification: true,
      enableSpeakerDiarization: true,
      enableEndpointDetection: true,
      translation: translationConfig ?? undefined,

      onFinished: () => {
        onFinished?.();
      },
      onStarted: () => {
        onStarted?.();
      },

      onError: (
        status: ErrorStatus,
        message: string,
        errorCode: number | undefined,
      ) => {
        console.error('❌ [VoiceTree] Soniox Error - Status:', status, 'Message:', message, 'Code:', errorCode);
        setError({ status, message, errorCode });
      },

      onStateChange: ({ newState }) => {
        setState(newState);
      },

      // When we receive some tokens back, sort them based on their status --
      // is it final or non-final token.
      onPartialResult(result) {
        // Forward raw SDK result to external handler (e.g., TranscriptionStore)
        onPartialResultCallback?.(result);

        const newFinalTokens: Token[] = [];
        const newNonFinalTokens: Token[] = [];

        for (const token of result.tokens) {
          if (token.is_final) {
            newFinalTokens.push(token);
          } else {
            newNonFinalTokens.push(token);
          }
        }

        setFinalTokens((previousTokens) => [
          ...previousTokens,
          ...newFinalTokens,
        ]);
        setNonFinalTokens(newNonFinalTokens);
      },
    });
  }, [apiKey, onFinished, onPartialResultCallback, onStarted, translationConfig]);

  const stopTranscription: () => void = useCallback(() => {
    sonioxClient.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      sonioxClient.current?.cancel();
    };
  }, []);

  return {
    startTranscription,
    stopTranscription,
    state,
    finalTokens,
    nonFinalTokens,
    error,
  };
}
