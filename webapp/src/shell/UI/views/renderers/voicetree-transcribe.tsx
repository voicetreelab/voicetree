import type {JSX} from "react";
import { useState, useEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";
import type { RecorderState } from "@soniox/speech-to-text-web";
import { cn } from "@/utils/lib/utils";
import AnimatedMicIcon from "@/shell/UI/views/components/animated-mic-icon";
import StatusDisplay from "@/shell/UI/views/components/status-display";
import useVoiceTreeClient from "@/shell/UI/views/hooks/useVoiceTreeClient";
import { useTranscriptionSender } from "@/shell/edge/UI-edge/text_to_tree_server_communication/useTranscriptionSender";
import getAPIKey, { prefetchAPIKey } from "@/utils/get-api-key";
import { TranscriptionDisplay } from "@/shell/UI/views/TranscriptionDisplay.tsx";
import { onVoiceResult, appendManualText, reset as resetTranscriptionStore, subscribe as subscribeToTranscription, getDisplayTokenCount } from "@/shell/edge/UI-edge/state/TranscriptionStore";
import type {} from "@/shell/electron";
import { ChevronDown } from "lucide-react";
import { initVoiceRecording, disposeVoiceRecording } from "@/shell/edge/UI-edge/state/VoiceRecordingController";
import { SseStatusPanel } from "@/shell/UI/sse-status-panel";

type InputMode = 'add' | 'ask' | null;

type TranscriptionErrorMessage = {
  readonly message: string;
};

interface TranscriptionOverlayProps {
  readonly hasTranscriptionText: boolean;
  readonly isTranscriptionExpanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
}

interface ControlRowProps {
  readonly connectionError: string | null;
  readonly inputMode: InputMode;
  readonly isConnecting: boolean;
  readonly isProcessing: boolean;
  readonly onKeyPress: (e: KeyboardEvent<HTMLInputElement>) => void;
  readonly onMicClick: () => void;
  readonly onTextChange: (value: string) => void;
  readonly onTextSubmit: () => void;
  readonly onToggleAskMode: () => void;
  readonly ssePanelMountRef: RefObject<HTMLDivElement | null>;
  readonly state: RecorderState;
  readonly textInput: string;
}

interface ErrorMessagesProps {
  readonly connectionError: string | null;
  readonly error: TranscriptionErrorMessage | null;
  readonly isMacPlatform: boolean;
  readonly micPermissionDenied: boolean;
  readonly onOpenMicrophoneSettings: () => void;
}

function TranscriptionOverlay({
  hasTranscriptionText,
  isTranscriptionExpanded,
  onToggleExpanded,
  scrollContainerRef,
}: TranscriptionOverlayProps): JSX.Element {
  return (
    <>
      <div
        className="absolute bottom-full left-0 right-0 transition-all duration-200"
        style={{ height: isTranscriptionExpanded && hasTranscriptionText ? '68px' : '0px', overflow: 'hidden' }}
      >
        {hasTranscriptionText && (
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
        )}
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto vt-transcription-content"
          style={{
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,1) 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,1) 100%)',
            zIndex: 1,
          }}
        >
          <TranscriptionDisplay scrollContainerRef={scrollContainerRef} />
        </div>
      </div>
      {hasTranscriptionText && (
        <button
          onClick={onToggleExpanded}
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
      )}
    </>
  );
}

function ControlRow({
  connectionError,
  inputMode,
  isConnecting,
  isProcessing,
  onKeyPress,
  onMicClick,
  onTextChange,
  onTextSubmit,
  onToggleAskMode,
  ssePanelMountRef,
  state,
  textInput,
}: ControlRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3 py-2">
      <div ref={ssePanelMountRef} className="w-[min(18vw,300px)] shrink-0 overflow-visible" />
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
      <button
        onClick={onMicClick}
        className={cn(
          "p-1 rounded-lg transition-all cursor-pointer",
          state === 'Running'
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : isConnecting
              ? "bg-orange-500 text-white hover:bg-orange-600"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        <AnimatedMicIcon isRecording={state === 'Running'} isConnecting={isConnecting} size={28} />
      </button>
      <div className="h-6 w-px bg-border" />
      <div className={cn(
        "flex items-center border border-input bg-background rounded-full overflow-hidden shadow-sm transition-all",
        inputMode !== null && "min-w-[320px]"
      )}>
        <button
          onClick={onToggleAskMode}
          className={cn(
            'px-2 py-0.5 text-xs transition-colors cursor-pointer m-1',
            inputMode === 'ask'
              ? 'bg-purple-600 text-white rounded-full'
              : 'text-muted-foreground hover:bg-accent rounded-full'
          )}
        >
          Ask
        </button>
        {inputMode !== null && (
          <>
            <div className="h-4 w-px bg-border" />
            <input
              type="text"
              value={textInput}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyPress={onKeyPress}
              placeholder={inputMode === 'ask'
                ? "Query for relevant context"
                : "Add to graph"}
              className="flex-1 px-3 py-1.5 bg-transparent focus:outline-none text-sm min-w-[180px]"
              disabled={isProcessing}
              autoFocus
            />
            <button
              onClick={onTextSubmit}
              disabled={isProcessing || !textInput.trim()}
              className="px-3 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ↑
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorMessages({
  connectionError,
  error,
  isMacPlatform,
  micPermissionDenied,
  onOpenMicrophoneSettings,
}: ErrorMessagesProps): JSX.Element | null {
  if (!(error ?? connectionError ?? micPermissionDenied)) {
    return null;
  }

  return (
    <div className="mt-3">
      {micPermissionDenied && (
        <div className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Microphone access is blocked
          </p>
          <p className="text-amber-700 dark:text-amber-300 mt-1">
            VoiceTree needs microphone access to transcribe your voice.
          </p>
          {isMacPlatform && (
            <button
              onClick={onOpenMicrophoneSettings}
              className="mt-2 text-amber-600 dark:text-amber-400 hover:underline font-medium cursor-pointer"
            >
              Open System Settings →
            </button>
          )}
        </div>
      )}
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
  );
}

export default function VoiceTreeTranscribe(): JSX.Element {
  const [textInput, setTextInput] = useState("");
  const [backendPort, setBackendPort] = useState<number | undefined>(undefined);
  const [isTranscriptionExpanded, setIsTranscriptionExpanded] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    const stored: string | null = localStorage.getItem('voicetree-input-mode');
    if (stored === 'ask') return 'ask';
    if (stored === 'add') return 'add';
    return null;
  });

  // Track if there's text in the transcription to conditionally show blur/collapse
  const [hasTranscriptionText, setHasTranscriptionText] = useState(false);

  // Track microphone permission denied state
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // Ref for scroll container (passed to TranscriptionDisplay for auto-scroll)
  const scrollContainerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

  // Ref for SSE status panel mount point and instance
  const ssePanelMountRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const ssePanelInstanceRef: RefObject<SseStatusPanel | null> = useRef<SseStatusPanel | null>(null);

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
    startTranscription,
    stopTranscription,
    cancelTranscription,
    error,
  } = useVoiceTreeClient({
    apiKey: getAPIKey,
    onPartialResult: onVoiceResult,  // Wire raw SDK events directly to store
  });

  // Prefetch Soniox API key on mount - fire and forget, key will be cached for when user clicks mic
  useEffect(() => {
    void prefetchAPIKey();
  }, []);

  // Fetch backend port on mount
  useEffect(() => {
    window.electronAPI?.main.getBackendPort().then((port: number | null) => {
      if (port) {
        setBackendPort(port);
      }
    }).catch(() => alert("port error"));
  }, []);

  // Use the transcription sender hook (auto-subscribes to TranscriptionStore)
  const {
    sendManualText,
    bufferLength: _bufferLength,
    isProcessing,
    connectionError,
    reset: resetSender,
  } = useTranscriptionSender({
    endpoint: backendPort ? `http://localhost:${backendPort}/send-text` : "http://localhost:8001/send-text",
  });


  // Mount SSE status panel - creates/disposes with component lifecycle
  useEffect(() => {
    if (ssePanelMountRef.current && !ssePanelInstanceRef.current) {
      ssePanelInstanceRef.current = new SseStatusPanel(ssePanelMountRef.current);
    }
    return () => {
      ssePanelInstanceRef.current?.dispose();
      ssePanelInstanceRef.current = null;
    };
  }, []);

  // Subscribe to TranscriptionStore to track if there's text
  useEffect(() => {
    const updateHasText: () => void = () => setHasTranscriptionText(getDisplayTokenCount() > 0);
    updateHasText(); // Initial check
    return subscribeToTranscription(updateHasText);
  }, []);

  // Start transcription with permission check and reset
  const handleStartTranscription: () => Promise<void> = async () => {
    // Check microphone permission before starting
    const status = await window.electronAPI?.main.checkMicrophonePermission();

    if (status === 'not-determined') {
      // First time - show native permission dialog
      const granted = await window.electronAPI?.main.requestMicrophonePermission();
      if (!granted) {
        setMicPermissionDenied(true);
        return;
      }
    } else if (status === 'denied' || status === 'restricted') {
      // Previously denied - show error with settings link
      setMicPermissionDenied(true);
      return;
    }

    // Permission granted - proceed with transcription
    setMicPermissionDenied(false);
    resetTranscriptionStore();
    resetSender();
    await startTranscription();
  };

  // Derive connecting state - orange for any transitional state (not idle, not running)
  const isConnecting = state !== 'Init' && state !== 'Finished' && state !== 'Error' && state !== 'Canceled' && state !== 'Running';

  // Handle mic button click - always responsive, force-cancels from stuck states
  const handleMicClick: () => void = () => {
    if (state === 'Running') {
      stopTranscription();
    } else if (isConnecting) {
      cancelTranscription();
    } else {
      void handleStartTranscription();
    }
  };

  // Initialize VoiceRecordingController to bridge React state with vanilla JS HotkeyManager
  useEffect(() => {
    initVoiceRecording(
      handleStartTranscription,
      stopTranscription,
      cancelTranscription,
      () => state
    );
    return () => {
      disposeVoiceRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleStartTranscription is stable, adding it causes infinite re-registration
  }, [state, stopTranscription, cancelTranscription]);

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

  // Handle Ask mode submission
  const handleAskSubmit: (question: string) => Promise<void> = async (question: string) => {
    try {
      // 1. Get relevant nodes from backend via IPC
      const response: { relevant_nodes?: Array<{ node_path: string; score: number; title: string }>; error?: string } | null | undefined =
        await window.electronAPI?.main.askQuery(question, 10);

      let nodePaths: string[];

      // Check for RPC error response
      if (response && 'error' in response && response.error) {
        console.error('Ask query returned error:', response.error);
        // Fall through to fallback behavior
      }

      // Check if we have valid results
      const hasValidResults: boolean = response !== null && response !== undefined &&
        'relevant_nodes' in response &&
        Array.isArray(response.relevant_nodes) &&
        response.relevant_nodes.length > 0;

      if (!hasValidResults) {
        // Fallback: get nodes from graph when search fails
        const graph: { nodes: Record<string, unknown> } | undefined = await window.electronAPI?.main.getGraph();
        if (!graph || Object.keys(graph.nodes).length === 0) {
          alert('No nodes in graph');
          return;
        }
        nodePaths = Object.keys(graph.nodes).slice(0, 100);
      } else {
        nodePaths = response!.relevant_nodes!.map(r => r.node_path);
      }

      // 2. Create context node and spawn terminal via IPC
      // Note: askModeCreateAndSpawn returns void on success, or { error: string } on RPC failure
      const result: unknown = await window.electronAPI?.main.askModeCreateAndSpawn(nodePaths, question);

      // Check for RPC error in askModeCreateAndSpawn
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error((result as { error: string }).error);
      }
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

    // Add mode - send to backend and update store
    await sendManualText(textInput);
    appendManualText(textInput);
    setTextInput("");
  };


  // Handle Enter key press
  const handleKeyPress: (e: KeyboardEvent<HTMLInputElement>) => void = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleTextSubmit();
    }
  };


  return (
    <div className="flex flex-col relative">
      <div className="bg-background relative z-20">
        <div className="max-w-4xl mx-auto relative">
          <TranscriptionOverlay
            hasTranscriptionText={hasTranscriptionText}
            isTranscriptionExpanded={isTranscriptionExpanded}
            onToggleExpanded={() => setIsTranscriptionExpanded(!isTranscriptionExpanded)}
            scrollContainerRef={scrollContainerRef}
          />
          <ControlRow
            connectionError={connectionError}
            inputMode={inputMode}
            isConnecting={isConnecting}
            isProcessing={isProcessing}
            onKeyPress={handleKeyPress}
            onMicClick={handleMicClick}
            onTextChange={setTextInput}
            onTextSubmit={() => void handleTextSubmit()}
            onToggleAskMode={() => setInputMode(inputMode === 'ask' ? null : 'ask')}
            ssePanelMountRef={ssePanelMountRef}
            state={state}
            textInput={textInput}
          />
          <ErrorMessages
            connectionError={connectionError}
            error={error}
            isMacPlatform={navigator.platform.includes('Mac')}
            micPermissionDenied={micPermissionDenied}
            onOpenMicrophoneSettings={() => { void window.electronAPI?.main.openMicrophoneSettings() }}
          />
        </div>
      </div>
    </div>
  );
}
