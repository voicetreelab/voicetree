import { useCallback, useEffect, useRef, useState } from "react";
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
}: UseVoiceTreeClientOptions) {
  const sonioxClient = useRef<SonioxClient | null>(null);

  if (sonioxClient.current == null) {
    sonioxClient.current = new SonioxClient({
      apiKey: apiKey,
    });
  }

  const [state, setState] = useState<RecorderState>("Init");
  const [finalTokens, setFinalTokens] = useState<Token[]>([]);
  const [nonFinalTokens, setNonFinalTokens] = useState<Token[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);

  const startTranscription = useCallback(async () => {
    console.log('🎤 [VoiceTree] Starting transcription...');
    setFinalTokens([]);
    setNonFinalTokens([]);
    setError(null);

    // Check if we have a client
    if (!sonioxClient.current) {
      console.error('❌ [VoiceTree] No Soniox client available!');
      return;
    }

    console.log('✅ [VoiceTree] Soniox client initialized');

    // First message we send contains configuration. Here we set if we set if we
    // are transcribing or translating. For translation we also set if it is
    // one-way or two-way.
    sonioxClient.current.start({
      model: "stt-rt-preview",
      enableLanguageIdentification: true,
      enableSpeakerDiarization: true,
      enableEndpointDetection: true,
      translation: translationConfig || undefined,

      onFinished: () => {
        console.log('🏁 [VoiceTree] Transcription finished');
        onFinished?.();
      },
      onStarted: () => {
        console.log('▶️ [VoiceTree] Transcription started successfully');
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
        console.log('🔄 [VoiceTree] State change:', newState);
        setState(newState);
      },

      // When we receive some tokens back, sort them based on their status --
      // is it final or non-final token.
      onPartialResult(result) {
        console.log('📝 [VoiceTree] Received partial result:', {
          tokenCount: result.tokens.length,
          tokens: result.tokens.map(t => ({ text: t.text, is_final: t.is_final }))
        });

        const newFinalTokens: Token[] = [];
        const newNonFinalTokens: Token[] = [];

        for (const token of result.tokens) {
          if (token.is_final) {
            newFinalTokens.push(token);
          } else {
            newNonFinalTokens.push(token);
          }
        }

        if (newFinalTokens.length > 0) {
          console.log('✅ [VoiceTree] Final tokens:', newFinalTokens.map(t => t.text).join(' '));
        }
        if (newNonFinalTokens.length > 0) {
          console.log('⏳ [VoiceTree] Non-final tokens:', newNonFinalTokens.map(t => t.text).join(' '));
        }

        setFinalTokens((previousTokens) => [
          ...previousTokens,
          ...newFinalTokens,
        ]);
        setNonFinalTokens(newNonFinalTokens);
      },
    });
  }, [onFinished, onStarted, translationConfig]);

  const stopTranscription = useCallback(() => {
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
