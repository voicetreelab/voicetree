import { useEffect, useRef } from 'react';
import { VoiceInputView } from '@/views/VoiceInputView';

/**
 * React wrapper component for vanilla VoiceInputView
 *
 * This is a bridge component that allows the vanilla TypeScript VoiceInputView
 * to be used within the React app during the transition period.
 */
export default function VoiceInputViewWrapper() {
  const containerRef = useRef<HTMLDivElement>(null);
  const voiceInputRef = useRef<VoiceInputView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize VoiceInputView
    voiceInputRef.current = new VoiceInputView(containerRef.current);

    // Subscribe to events (for debugging/logging)
    const unsubscribeTranscription = voiceInputRef.current.onTranscription((text) => {
      console.log('Transcription received:', text);
    });

    const unsubscribeError = voiceInputRef.current.onError((error) => {
      console.error('Voice input error:', error);
      // Show user-friendly error
      alert(`Voice input error: ${error}`);
    });

    // Cleanup on unmount
    return () => {
      unsubscribeTranscription();
      unsubscribeError();
      voiceInputRef.current?.dispose();
      voiceInputRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="border rounded-lg bg-white shadow-sm"
      style={{ minHeight: '200px' }}
    />
  );
}
