import { useState, useEffect, useRef } from "react";
import StatusDisplay from "../components/status-display";
import RecordButton from "../components/record-button";
import SoundWaveVisualizer from "../components/sound-wave-visualizer";
import useVoiceTreeClient from "@/hooks/useVoiceTreeClient";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";
import { type Token } from "@soniox/speech-to-text-web";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Send, AlertCircle } from "lucide-react";

export default function VoiceTreeTranscribe() {
  const [bufferLength, setBufferLength] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);
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

  const allTokens = [...finalTokens, ...nonFinalTokens];
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
  const getTranscriptText = (tokens: any[]): string => {
    return tokens
      .filter(token => token.text !== "<end>")
      .map(token => token.text)
      .join(" ");
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
    <div className="bg-[#f2f2f2] rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">VoiceTree Live Transcribe</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            Buffer: <span className="font-mono font-semibold text-blue-600">{bufferLength}</span> chars
            {isProcessing && <span className="ml-2 text-orange-500">⚡ Processing...</span>}
          </div>
          <StatusDisplay state={state} />
        </div>
      </div>

      {/* Transcription Display - Always visible, no toggle */}
      <div
        ref={autoScrollRef}
        className="h-[400px] overflow-y-auto p-4 border rounded-lg bg-white mb-4"
      >
        <Renderer
          tokens={allTokens}
          placeholder="Click start to begin transcribing for VoiceTree"
        />
      </div>

      {error && (
        <Alert className="mb-4" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="font-medium">
            {error.message.includes('apiKey')
              ? 'Invalid or missing Soniox API key. Please check your .env file.'
              : error.message.includes('network') || error.message.includes('Failed to fetch')
              ? 'Cannot connect to Soniox service. Please check your internet connection and API key.'
              : `Soniox error: ${error.message}`}
          </AlertDescription>
        </Alert>
      )}

      <div className="text-center mb-4">
        <RecordButton
          state={state}
          stopTranscription={stopTranscription}
          startTranscription={startTranscription}
        />
        <div className="mt-2 text-xs text-gray-500">
          Speech is automatically sent to VoiceTree as you speak
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-gray-200">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            {state === 'Running' ? (
              <div className="px-4 py-2 border border-gray-300 rounded-lg bg-gray-50">
                <SoundWaveVisualizer
                  isActive={state === 'Running'}
                  fallbackAnimation={true}
                  barCount={30}
                  barColor="rgb(59, 130, 246)"
                  className="w-full h-8"
                />
              </div>
            ) : (
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Or type text here and press Enter..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isProcessing}
              />
            )}
          </div>
          {state !== 'Running' && (
            <button
              onClick={handleTextSubmit}
              disabled={isProcessing || !textInput.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}