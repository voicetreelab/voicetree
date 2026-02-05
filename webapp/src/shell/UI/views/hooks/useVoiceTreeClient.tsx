import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  SonioxClient,
  type ErrorStatus,
  type RecorderState,
  type Token,
  type TranslationConfig,
} from "@soniox/speech-to-text-web";
import {
  type ReconnectionState,
  createReconnectionState,
  shouldRetry,
  recordAttempt,
  resetAttempts,
  scheduleReconnection,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAY_MS,
} from "./reconnectionManager";
import { forceRefreshAPIKey } from "../../../../utils/get-api-key";

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

// Proactive restart interval: 18 minutes (before the ~20-min Soniox timeout)
const PROACTIVE_RESTART_INTERVAL_MS = 18 * 60 * 1000;

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
  const proactiveRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  // Track reactive reconnection state using extracted reconnection manager
  const reconnectionStateRef = useRef<ReconnectionState>(createReconnectionState());
  // Refs to hold latest function versions (avoids stale closure issues with mutual recursion)
  const startAndScheduleRef = useRef<() => void>(() => {});

  sonioxClient.current ??= new SonioxClient({
    apiKey,
  });

  const [state, setState] = useState<RecorderState>("Init");
  const [error, setError] = useState<TranscriptionError | null>(null);

  // Clear the proactive restart timer
  const clearProactiveTimer = useCallback(() => {
    if (proactiveRestartTimerRef.current) {
      clearTimeout(proactiveRestartTimerRef.current);
      proactiveRestartTimerRef.current = null;
    }
  }, []);

  // Schedule proactive restart to prevent ~20-min Soniox timeout
  const scheduleProactiveRestart = useCallback(() => {
    clearProactiveTimer();
    proactiveRestartTimerRef.current = setTimeout(() => {
      if (isRecordingRef.current) {
        console.log('🔄 [VoiceTree] Proactive restart triggered (18-min interval), refreshing API key');
        void forceRefreshAPIKey().then(() => {
          if (isRecordingRef.current) {
            startAndScheduleRef.current();
          }
        });
      }
    }, PROACTIVE_RESTART_INTERVAL_MS);
  }, [clearProactiveTimer]);

  // Internal start function (used by both initial start and restarts)
  const startTranscriptionInternal = useCallback(async () => {
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
        // Reset reconnection state on successful start
        reconnectionStateRef.current = resetAttempts();
        onStarted?.();
      },

      onError: (
        status: ErrorStatus,
        message: string,
        errorCode: number | undefined,
      ) => {
        console.error('❌ [VoiceTree] Soniox Error - Status:', status, 'Message:', message, 'Code:', errorCode);

        // Reactive reconnection: auto-recover from ANY error (at least one attempt)
        if (shouldRetry(reconnectionStateRef.current, isRecordingRef.current)) {
          reconnectionStateRef.current = recordAttempt(reconnectionStateRef.current);
          const attemptNum = reconnectionStateRef.current.attempts;
          console.log(`🔄 [VoiceTree] Error occurred, attempting reactive reconnection in 1s... (attempt ${attemptNum}/${MAX_RECONNECT_ATTEMPTS})`);
          scheduleReconnection(
            () => isRecordingRef.current,
            () => {
              void forceRefreshAPIKey().then(() => {
                if (isRecordingRef.current) {
                  startAndScheduleRef.current();
                }
              });
            },
            RECONNECT_DELAY_MS
          );
          return;
        }

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

  // Keep the ref up-to-date with latest functions
  startAndScheduleRef.current = () => {
    void startTranscriptionInternal();
    scheduleProactiveRestart();
  };

  const startTranscription: () => Promise<void> = useCallback(async () => {
    isRecordingRef.current = true;
    reconnectionStateRef.current = resetAttempts(); // Reset attempts on manual start
    await startTranscriptionInternal();
    scheduleProactiveRestart();
  }, [startTranscriptionInternal, scheduleProactiveRestart]);

  const stopTranscription: () => void = useCallback(() => {
    isRecordingRef.current = false;
    clearProactiveTimer();
    sonioxClient.current?.stop();
  }, [clearProactiveTimer]);

  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (proactiveRestartTimerRef.current) {
        clearTimeout(proactiveRestartTimerRef.current);
      }
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
