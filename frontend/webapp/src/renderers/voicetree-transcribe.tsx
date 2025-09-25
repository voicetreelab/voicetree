import { useState, useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusDisplay from "../components/status-display";
import SoundWaveVisualizer from "../components/sound-wave-visualizer";
import useVoiceTreeClient from "@/hooks/useVoiceTreeClient";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";
import { type Token } from "@soniox/speech-to-text-web";

export default function VoiceTreeTranscribe() {
  const [bufferLength, setBufferLength] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [allFinalTokens, setAllFinalTokens] = useState<Token[]>([]);
  const lastSentText = useRef<string>("");

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

  // Track how many voice tokens we've seen to append new ones only
  const voiceTokenCountRef = useRef(0);

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
    }
  }, [finalTokens]);

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

  // Extract text from tokens for sending to server
  const getTranscriptText = (tokens: Token[]): string => {
    return tokens
      .filter(token => token.text !== "<end>")
      .map(token => token.text)
      .join("");
  };

  // Send text to VoiceTree and get buffer length
  const sendToVoiceTree = async (text: string) => {
    if (!text.trim() || text === lastSentText.current) return;

    setIsProcessing(true);
    lastSentText.current = text;

    try {
      const response = await fetch("http://localhost:8000/send-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.buffer_length !== undefined) {
          setBufferLength(result.buffer_length);
        }
        setConnectionError(null);
      } else {
        setConnectionError(`Server error: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error("Error sending to VoiceTree:", err);
      setConnectionError("Cannot connect to VoiceTree server (http://localhost:8000)");
    } finally {
      setIsProcessing(false);
    }
  };

  // Continuously send final tokens to server
  useEffect(() => {
    const currentText = getTranscriptText(finalTokens);
    if (currentText && currentText !== lastSentText.current) {
      sendToVoiceTree(currentText);
    }
  }, [finalTokens]);

  // Handle manual text submission
  const handleTextSubmit = () => {
    if (textInput.trim()) {
      sendToVoiceTree(textInput);

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
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        console.log('✅ Microphone permission granted');
        stream.getTracks().forEach(track => track.stop()); // Stop the stream
      })
      .catch(err => {
        console.error('❌ Microphone permission denied:', err);
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
    <div className="h-screen flex flex-col bg-background relative">
      {/* Background Wave Visualizer - Always visible */}
      <div className="absolute inset-0 pointer-events-none z-10 opacity-20">
        <SoundWaveVisualizer
          isActive={true}
          fallbackAnimation={true}
          barCount={40}
          barColor="rgb(59, 130, 246)"
          className="w-full h-full"
        />
      </div>

      {/* Header with Status Bar */}
      <div className="border-b bg-background/95 backdrop-blur-sm relative z-20">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-2 text-xs bg-muted/30">
          <div className="flex items-center gap-4">
            <StatusDisplay state={state} />
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
        className="h-1/4 overflow-y-auto p-4 border rounded-lg bg-white/95 backdrop-blur-sm mb-4 relative z-20"
      >
        <Renderer
          tokens={allTokens}
          placeholder="Click start to begin transcribing for VoiceTree"
        />
      </div>

      {/* Input Section - at bottom */}
      <div className="border-t bg-background/95 backdrop-blur-sm p-4 relative z-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2">
            {/* Mic Button */}
            <button
              onClick={state === 'Running' ? stopTranscription : startTranscription}
              className={cn(
                "p-3 rounded-lg transition-all",
                state === 'Running'
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {state === 'Running' ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
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