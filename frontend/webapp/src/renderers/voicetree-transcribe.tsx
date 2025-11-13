import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import AnimatedMicIcon from "@/components/animated-mic-icon";
import StatusDisplay from "@/components/status-display";
import useVoiceTreeClient from "@/hooks/useVoiceTreeClient";
import { useTranscriptionSender } from "@/hooks/useTranscriptionSender";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";
import { type Token } from "@soniox/speech-to-text-web";

export default function VoiceTreeTranscribe() {
  const [textInput, setTextInput] = useState("");
  const [allFinalTokens, setAllFinalTokens] = useState<Token[]>([]);
  const [backendPort, setBackendPort] = useState<number | undefined>(undefined);

  const {
    state,
    finalTokens,
    nonFinalTokens,
    startTranscription,
    stopTranscription,
    error,
  } = useVoiceTreeClient({
    apiKey: getAPIKey,
  });

  // Fetch backend port on mount
  useEffect(() => {
    window.electronAPI?.getBackendPort().then((port: number | null) => {
      if (port) {
        setBackendPort(port);
      }
    });
  }, []);

  // Use the new transcription sender hook
  const {
    sendIncrementalTokens,
    sendManualText,
    bufferLength,
    isProcessing,
    connectionError,
    reset: resetSender,
  } = useTranscriptionSender({
    endpoint: backendPort ? `http://localhost:${backendPort}/send-text` : "http://localhost:8001/send-text",
  });

  // Track how many voice tokens we've seen to append new ones only
  const voiceTokenCountRef = useRef(0);
  // Track if we're currently sending to prevent duplicate sends
  const isSendingRef = useRef(false);
  const lastSentCountRef = useRef(0);

  // Append new voice final tokens to our combined list
  useEffect(() => {
    if (finalTokens.length > voiceTokenCountRef.current) {
      const newTokens = finalTokens.slice(voiceTokenCountRef.current);
      setAllFinalTokens(prev => [...prev, ...newTokens]);
      voiceTokenCountRef.current = finalTokens.length;
    } else if (finalTokens.length === 0) {
      // Reset when transcription restarts
      voiceTokenCountRef.current = 0;
      setAllFinalTokens([]);
      resetSender(); // Reset the sender when transcription restarts
      lastSentCountRef.current = 0;
    }
  }, [finalTokens, resetSender]);

  // Combine all tokens for display
  const allTokens = [...allFinalTokens, ...nonFinalTokens];
  const autoScrollRef = useAutoScroll(allTokens);

  // Show error popup when Soniox fails
  useEffect(() => {
    if (error) {
      // Show a more user-friendly error message
      const errorMessage = error.message.includes('apiKey')
        ? 'Invalid or missing Soniox API key. Please check your configuration.'
        : error.message.includes('network')
        ? 'Cannot connect to Soniox service. Please check your internet connection.'
        : `Soniox error: ${error.message}`;

      alert(errorMessage);
      console.error('Soniox Error:', error);
    }
  }, [error]);

  // Send incremental FINAL tokens to server (only new ones)
  useEffect(() => {
    if (finalTokens.length > 0 && finalTokens.length > lastSentCountRef.current) {
      // Only proceed if we have new tokens and not already sending
      if (isSendingRef.current) {
        console.log('Skipping send - already in progress');
        return;
      }

      isSendingRef.current = true;

      // Use async function to handle the send
      const doSend = async () => {
        try {
          await sendIncrementalTokens(finalTokens);
          lastSentCountRef.current = finalTokens.length;
        } finally {
          isSendingRef.current = false;
        }
      };

      doSend();
    }
  }, [finalTokens, sendIncrementalTokens]);

  // Handle manual text submission
  const handleTextSubmit = async () => {
    if (textInput.trim()) {
      // Send the manual text
      await sendManualText(textInput);

      // Create tokens from the manual text input
      const tokensToAdd: Token[] = [];

      // Add a newline token if there are existing tokens
      if (allFinalTokens.length > 0) {
        tokensToAdd.push({
          text: "\n",
          is_final: true,
          speaker: undefined,
          language: undefined,
          confidence: 1.0,
        });
      }

      // Add the actual text token
      tokensToAdd.push({
        text: textInput,
        is_final: true,
        speaker: undefined,
        language: undefined,
        confidence: 1.0,
      });

      // Append to final tokens
      setAllFinalTokens(prev => [...prev, ...tokensToAdd]);
      setTextInput("");
    }
  };

  // Check microphone permissions on mount
  useEffect(() => {
    console.log('🎤 [VoiceTree] Checking microphone permissions...');
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        console.log('✅ [VoiceTree] Microphone permission granted');
        console.log('🔊 [VoiceTree] Audio tracks:', stream.getAudioTracks().map(track => ({
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings()
        })));
        stream.getTracks().forEach(track => track.stop()); // Stop the stream
      })
      .catch(err => {
        console.error('❌ [VoiceTree] Microphone permission denied:', err);
        console.error('❌ [VoiceTree] Error details:', {
          name: err.name,
          message: err.message,
          constraint: err.constraint
        });
      });
  }, []);

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };


  return (
    <div className="flex flex-col bg-background relative">
      {/*/!* Background Wave Visualizer - Always visible *!/*/}
      {/*<div className="absolute inset-0 pointer-events-none z-10 opacity-20">*/}
      {/*  <SoundWaveVisualizer*/}
      {/*    isActive={true}*/}
      {/*    fallbackAnimation={true}*/}
      {/*    barCount={40}*/}
      {/*    barColor="rgb(59, 130, 246)"*/}
      {/*    className="w-full h-full"*/}
      {/*  />*/}
      {/*</div>*/}

      {/* Header with Status Bar */}
      <div className="border-b bg-background/95 backdrop-blur-sm relative z-20">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-1 text-xs bg-muted/30">
          <div className="flex items-center gap-4">
            <StatusDisplay state={state} port={backendPort} />
            {bufferLength > 0 && (
              <span className="text-muted-foreground">
                Buffer: <span className="font-mono font-semibold text-primary">{bufferLength}</span>
              </span>
            )}
            {isProcessing && (
              <span className="text-amber-600 flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                Processing
              </span>
            )}
            {connectionError && (
              <span className="text-destructive text-xs">⚠️ Server Offline</span>
            )}
          </div>
        </div>
      </div>

      {/* Transcription Display - Always visible */}
      <div
        ref={autoScrollRef}
        className="h-20 overflow-y-auto border rounded-lg bg-white/95 backdrop-blur-sm mb-2 relative z-20"
      >
        <Renderer
          tokens={allTokens}
          placeholder="Click here to begin transcribing for VoiceTree"
          onPlaceholderClick={startTranscription}
        />
      </div>

      {/* Input Section - at bottom */}
      <div className="border-t bg-background/95 backdrop-blur-sm relative z-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            {/* Mic Button */}
            <button
              onClick={state === 'Running' ? stopTranscription : startTranscription}
              className={cn(
                "p-1 rounded-lg transition-all",
                state === 'Running'
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <AnimatedMicIcon isRecording={state === 'Running'} size={28} />
            </button>

            {/* Text Input */}
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={state === 'Running' ? "Type text while recording..." : "Or type text here and press Enter..."}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isProcessing}
            />

            {/* Send Button - always visible */}
            <button
              onClick={handleTextSubmit}
              disabled={isProcessing || !textInput.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>

          {/* Error Messages */}
          {(error || connectionError) && (
            <div className="mt-3">
              {connectionError && (
                <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded px-3 py-2">
                  {connectionError} - Transcription continues offline
                </div>
              )}
              {error && (
                <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2 mt-2">
                  {error.message}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}