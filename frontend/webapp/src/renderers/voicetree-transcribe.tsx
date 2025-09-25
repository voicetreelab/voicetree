import { useState, useEffect, useRef } from "react";
import StatusDisplay from "../components/status-display";
import RecordButton from "../components/record-button";
import useSonioxClient from "@/hooks/useSonioxClient";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";
import { type Token } from "@soniox/speech-to-text-web";

export default function VoiceTreeTranscribe() {
  const [bufferLength, setBufferLength] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const lastSentText = useRef<string>("");

  const {
    state,
    finalTokens,
    nonFinalTokens,
    startTranscription,
    stopTranscription,
    error,
  } = useSonioxClient({
    apiKey: getAPIKey,
  });

  const allTokens = [...finalTokens, ...nonFinalTokens];
  const autoScrollRef = useAutoScroll(allTokens);

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
      }
    } catch (err) {
      console.error("Error sending to VoiceTree:", err);
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

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div className="text-red-700 text-sm">Error: {error.message}</div>
        </div>
      )}

      <div className="text-center">
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
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Or type text here and press Enter..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isProcessing}
          />
          <button
            onClick={handleTextSubmit}
            disabled={isProcessing || !textInput.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}