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
    console.log('=== Initializing Soniox Client ===');
    console.log('API key type:', typeof apiKey);
    console.log('API key is function?:', typeof apiKey === 'function');

    sonioxClient.current = new SonioxClient({
      apiKey: apiKey,
    });
    console.log('Soniox client created:', !!sonioxClient.current);
    console.log('==================================');
  }

  const [state, setState] = useState<RecorderState>("Init");
  const [finalTokens, setFinalTokens] = useState<Token[]>([]);
  const [nonFinalTokens, setNonFinalTokens] = useState<Token[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);

  const startTranscription = useCallback(async () => {
    console.log('=== Starting Transcription ===');
    console.log('Clearing tokens and errors');
    setFinalTokens([]);
    setNonFinalTokens([]);
    setError(null);

    // Check if we have a client
    if (!sonioxClient.current) {
      console.error('No Soniox client available!');
      return;
    }

    console.log('Starting Soniox client...');

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
        console.log('=== Transcription FINISHED ===');
        if (onFinished) onFinished();
      },
      onStarted: () => {
        console.log('=== Transcription STARTED Successfully ===');
        if (onStarted) onStarted();
      },

      onError: (
        status: ErrorStatus,
        message: string,
        errorCode: number | undefined,
      ) => {
        console.error('=== useVoiceTreeClient ERROR ===');
        console.error('Status:', status);
        console.error('Message:', message);
        console.error('Error code:', errorCode);
        console.error('=================================');
        setError({ status, message, errorCode });
      },

      onStateChange: ({ newState }) => {
        console.log('=== useVoiceTreeClient State Change ===');
        console.log('New state:', newState);
        console.log('========================================');
        setState(newState);
      },

      // When we receive some tokens back, sort them based on their status --
      // is it final or non-final token.
      onPartialResult(result) {
        console.log('=== useVoiceTreeClient onPartialResult ===');
        console.log('Received result:', result);
        console.log('Number of tokens:', result.tokens?.length || 0);

        const newFinalTokens: Token[] = [];
        const newNonFinalTokens: Token[] = [];

        for (const token of result.tokens) {
          console.log('Token:', { text: token.text, is_final: token.is_final });
          if (token.is_final) {
            newFinalTokens.push(token);
          } else {
            newNonFinalTokens.push(token);
          }
        }

        console.log('New final tokens:', newFinalTokens.length);
        console.log('New non-final tokens:', newNonFinalTokens.length);
        console.log('=========================================');

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
