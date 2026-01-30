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
  error: TranscriptionError | null;
} {
  const sonioxClient: RefObject<SonioxClient | null> = useRef<SonioxClient | null>(null);

  sonioxClient.current ??= new SonioxClient({
    apiKey,
  });

  const [state, setState] = useState<RecorderState>("Init");
  const [error, setError] = useState<TranscriptionError | null>(null);

  const startTranscription: () => Promise<void> = useCallback(async () => {
    // Kill any existing client and create fresh one
    sonioxClient.current?.cancel();
    sonioxClient.current = new SonioxClient({ apiKey });

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

      // Forward raw SDK result to external handler (e.g., TranscriptionStore)
      onPartialResult(result) {
        onPartialResultCallback?.(result);
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
    error,
  };
}
