import type {JSX} from "react";
import { useState, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { cn } from "@/utils/lib/utils";
import AnimatedMicIcon from "@/shell/UI/views/components/animated-mic-icon";
import StatusDisplay from "@/shell/UI/views/components/status-display";
import useVoiceTreeClient from "@/shell/UI/views/hooks/useVoiceTreeClient";
import { useTranscriptionSender } from "@/shell/edge/UI-edge/text_to_tree_server_communication/useTranscriptionSender";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/shell/UI/views/hooks/useAutoScroll";
import { type Token } from "@soniox/speech-to-text-web";
import type {} from "@/shell/electron";
import { ChevronDown } from "lucide-react";

type InputMode = 'add' | 'ask' | null;

export default function VoiceTreeTranscribe(): JSX.Element {
  const [textInput, setTextInput] = useState("");
  const [allFinalTokens, setAllFinalTokens] = useState<Token[]>([]);
  const [backendPort, setBackendPort] = useState<number | undefined>(undefined);
  const [isTranscriptionExpanded, setIsTranscriptionExpanded] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    const stored: string | null = localStorage.getItem('voicetree-input-mode');
    if (stored === 'ask') return 'ask';
    if (stored === 'add') return 'add';
    return null;
  });

  // Persist mode changes
  useEffect(() => {
    if (inputMode === null) {
      localStorage.removeItem('voicetree-input-mode');
    } else {
      localStorage.setItem('voicetree-input-mode', inputMode);
    }
  }, [inputMode]);

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
    window.electronAPI?.main.getBackendPort().then((port: number | null) => {
      if (port) {
        setBackendPort(port);
      }
    }).catch(() => alert("port error"));
  }, []);

  // Use the new transcription sender hook
  const {
    sendIncrementalTokens,
    sendManualText,
    bufferLength: _bufferLength,
    isProcessing,
    connectionError,
    reset: resetSender,
  } = useTranscriptionSender({
    endpoint: backendPort ? `http://localhost:${backendPort}/send-text` : "http://localhost:8001/send-text",
  });

  // Track how many voice tokens we've seen to append new ones only
  const voiceTokenCountRef: RefObject<number> = useRef(0);
  // Track last sent count to avoid duplicate sends
  const lastSentCountRef: RefObject<number> = useRef(0);

  // Append new voice final tokens to our combined list
  useEffect(() => {
    if (finalTokens.length > voiceTokenCountRef.current) {
      const newTokens: Token[] = finalTokens.slice(voiceTokenCountRef.current);
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
  const allTokens: Token[] = [...allFinalTokens, ...nonFinalTokens];
  const autoScrollRef: RefObject<HTMLDivElement | null> = useAutoScroll(allTokens);

  // Show error popup when Soniox fails
  useEffect(() => {
    if (error) {
      // Show a more user-friendly error message
      const errorMessage: string = error.message.includes('apiKey')
        ? 'Invalid or missing Soniox API key. Please check your configuration.'
        : error.message.includes('network')
        ? 'Cannot connect to Soniox service. Please check your internet connection.'
        : `Soniox error: ${error.message}`;

      alert(errorMessage);
      console.error('Soniox Error:', error);
    }
  }, [error]);

  // Send incremental FINAL tokens to server (only new ones)
  // sendIncrementalTokens is non-blocking - it updates preview chip live
  useEffect(() => {
    if (finalTokens.length > 0 && finalTokens.length > lastSentCountRef.current) {
      void sendIncrementalTokens(finalTokens);
      lastSentCountRef.current = finalTokens.length;
    }
  }, [finalTokens, sendIncrementalTokens]);

  // Handle Ask mode submission
  const handleAskSubmit: (question: string) => Promise<void> = async (question: string) => {
    try {
      // 1. Get relevant nodes from backend via IPC
      const response: { relevant_nodes: Array<{ node_path: string; score: number; title: string }> } | null =
        await window.electronAPI?.main.askQuery(question, 10);

      if (!response || response.relevant_nodes.length === 0) {
        alert('No relevant nodes found for your question');
        return;
      }

      const nodePaths: string[] = response.relevant_nodes.map(r => r.node_path);

      // 2. Create context node and spawn terminal via IPC
      await window.electronAPI?.main.askModeCreateAndSpawn(nodePaths, question);
    } catch (err) {
      console.error('Ask mode failed:', err);
      alert(`Ask failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Handle manual text submission
  const handleTextSubmit: () => Promise<void> = async () => {
    if (!textInput.trim()) return;

    if (inputMode === 'ask') {
      await handleAskSubmit(textInput);
      setTextInput("");
      return;
    }

    // Add mode - existing behavior
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
  };

  // Check microphone permissions on mount
  useEffect(() => {
    console.log('🎤 [VoiceTree] Checking microphone permissions...');
    navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false  // Prevent system volume changes
      }
    })
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
  const handleKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => void = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleTextSubmit();
    }
  };


  return (
    <div className="flex flex-col relative">
      {/* Input Section - at bottom with solid background */}
      <div className="bg-background relative z-20">
        <div className="max-w-4xl mx-auto relative">
          {/* Transcription Display - positioned absolutely above input, aligned to input width */}
          <div
            className="absolute bottom-full left-0 right-0 transition-all duration-200"
            style={{ height: isTranscriptionExpanded ? '68px' : '0px', overflow: 'hidden' }}
          >
            {/* Smooth gradient blur layer - single element with gradient mask */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                zIndex: 0,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: '12px',
                maskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.2) 70%, rgba(0,0,0,0) 100%)',
                WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.2) 70%, rgba(0,0,0,0) 100%)',
              }}
            />
            {/* Scrollable text content with opacity gradient */}
            <div
              ref={autoScrollRef}
              className="absolute inset-0 overflow-y-auto"
              style={{
                maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,1) 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,1) 100%)',
                zIndex: 1,
              }}
            >
              <Renderer
                tokens={allTokens}
                placeholder=""
                onPlaceholderClick={() => void startTranscription()}
                isRecording={state === 'Running'}
              />
            </div>
          </div>
          {/* Expand/Collapse toggle button - positioned just above input row */}
          <button
            onClick={() => setIsTranscriptionExpanded(!isTranscriptionExpanded)}
            className="absolute right-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            style={{ zIndex: 2, bottom: '100%', marginBottom: '-14px' }}
            title={isTranscriptionExpanded ? "Collapse transcription" : "Expand transcription"}
          >
            <ChevronDown
              size={16}
              className={cn(
                "transition-transform duration-200",
                isTranscriptionExpanded ? "" : "rotate-180"
              )}
            />
          </button>


          {/* Offset left by half minimap width to center controls relative to full viewport */}
          <div className="flex items-center justify-center gap-3 py-2 mr-[min(calc(3vw+10px),80px)]">
            {/* Status Section */}
            <div className="flex items-center gap-2 text-xs">
              <StatusDisplay state={state} />
              {isProcessing && (
                <span className="text-amber-600 flex items-center gap-1">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                </span>
              )}
              {connectionError && (
                <span className="text-destructive text-xs">Server Offline</span>
              )}
            </div>


            {/* Mic Button */}
            <button
              onClick={() => state === 'Running' ? stopTranscription() : void startTranscription()}
              className={cn(
                "p-1 rounded-lg transition-all cursor-pointer",
                state === 'Running'
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <AnimatedMicIcon isRecording={state === 'Running'} size={28} />
            </button>

            {/* Divider */}
            <div className="h-6 w-px bg-border" />

            {/* Input Pill - Unified rounded container that expands */}
            <div className={cn(
              "flex items-center border border-input bg-background rounded-full overflow-hidden shadow-sm transition-all",
              inputMode !== null && "min-w-[320px]"
            )}>
              {/* Add Button */}
              <button
                onClick={() => setInputMode(inputMode === 'add' ? null : 'add')}
                className={cn(
                  'px-2 py-0.5 text-xs transition-colors cursor-pointer m-1',
                  inputMode === 'add'
                    ? 'bg-blue-600 text-white rounded-full'
                    : 'text-muted-foreground hover:bg-accent rounded-full'
                )}
              >
                Add
              </button>

              {/* Separator between Add/Ask */}
              <div className="h-4 w-px bg-border" />

              {/* Ask Button */}
              <button
                onClick={() => setInputMode(inputMode === 'ask' ? null : 'ask')}
                className={cn(
                  'px-2 py-0.5 text-xs transition-colors cursor-pointer m-1',
                  inputMode === 'ask'
                    ? 'bg-purple-600 text-white rounded-full'
                    : 'text-muted-foreground hover:bg-accent rounded-full'
                )}
              >
                Ask
              </button>

              {/* Expanded: Input + Send */}
              {inputMode !== null && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={inputMode === 'ask'
                      ? "Query for relevant context"
                      : "Add to graph"}
                    className="flex-1 px-3 py-1.5 bg-transparent focus:outline-none text-sm min-w-[180px]"
                    disabled={isProcessing}
                    autoFocus
                  />
                  <button
                    onClick={() => void handleTextSubmit()}
                    disabled={isProcessing || !textInput.trim()}
                    className="px-3 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    ↑
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Error Messages */}
          {(error ?? connectionError) && (
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