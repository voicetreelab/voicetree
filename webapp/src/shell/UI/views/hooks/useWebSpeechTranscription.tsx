import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';

export type TranscriptionState = 'Idle' | 'Starting' | 'Running' | 'Stopping' | 'Stopped';

interface TranscriptionToken {
  text: string;
  is_final: boolean;
  timestamp?: number;
}

export default function useWebSpeechTranscription(): {
  state: TranscriptionState;
  finalTokens: TranscriptionToken[];
  nonFinalTokens: TranscriptionToken[];
  error: Error | null;
  startTranscription: () => void;
  stopTranscription: () => void;
} {
  const [state, setState] = useState<TranscriptionState>('Idle');
  const [finalTokens, setFinalTokens] = useState<TranscriptionToken[]>([]);
  const [nonFinalTokens, setNonFinalTokens] = useState<TranscriptionToken[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const recognitionRef: RefObject<SpeechRecognition | null> = useRef<SpeechRecognition | null>(null);

  const startTranscription: () => void = useCallback(() => {
    //console.log('Starting Web Speech API transcription...');
    setError(null);
    setFinalTokens([]);
    setNonFinalTokens([]);
    setState('Starting');

    try {
      const SpeechRecognitionAPI: { new (): SpeechRecognition; prototype: SpeechRecognition; } = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognitionAPI) {
        throw new Error('Web Speech API is not supported in this browser');
      }

      const recognition: SpeechRecognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        //console.log('Speech recognition started');
        setState('Running');
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        //console.log('Speech result received');
        const newFinalTokens: TranscriptionToken[] = [];
        const newNonFinalTokens: TranscriptionToken[] = [];

        // Process only the new results since last event
        for (let i: number = event.resultIndex; i < event.results.length; i++) {
          const result: SpeechRecognitionResult = event.results[i];
          const transcript: string = result[0].transcript;

          if (result.isFinal) {
            newFinalTokens.push({
              text: transcript,
              is_final: true,
              timestamp: Date.now()
            });
          } else {
            newNonFinalTokens.push({
              text: transcript,
              is_final: false,
              timestamp: Date.now()
            });
          }
        }

        if (newFinalTokens.length > 0) {
          setFinalTokens(prev => [...prev, ...newFinalTokens]);
          setNonFinalTokens([]); // Clear non-final when we get final
        } else if (newNonFinalTokens.length > 0) {
          setNonFinalTokens(newNonFinalTokens); // Replace non-final tokens
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setError(new Error(`Speech recognition error: ${event.error}`));
        setState('Stopped');
      };

      recognition.onend = () => {
        //console.log('Speech recognition ended');
        setState('Stopped');
      };

      recognition.start();
      recognitionRef.current = recognition;

    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setError(err as Error);
      setState('Idle');
    }
  }, []);

  const stopTranscription: () => void = useCallback(() => {
    //console.log('Stopping transcription...');
    setState('Stopping');

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return {
    state,
    finalTokens,
    nonFinalTokens,
    error,
    startTranscription,
    stopTranscription
  };
}