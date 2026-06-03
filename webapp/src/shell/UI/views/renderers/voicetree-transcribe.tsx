import type {JSX} from "react";
import { useState, useEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";
import useVoiceTreeClient from "@/shell/UI/views/hooks/useVoiceTreeClient";
import { useTranscriptionSender } from "@/shell/edge/UI-edge/text_to_tree_server_communication/useTranscriptionSender";
import getAPIKey, { prefetchAPIKey } from "@/utils/get-api-key";
import { onVoiceResult, appendManualText, reset as resetTranscriptionStore, subscribe as subscribeToTranscription, getDisplayTokenCount } from "@/shell/edge/UI-edge/state/stores/TranscriptionStore";
import type {} from "@/shell/hostApi";
import { initVoiceRecording, disposeVoiceRecording } from "@/shell/edge/UI-edge/state/controllers/VoiceRecordingController";
import { SseStatusPanel } from "@/shell/UI/sse-status-panel";
import { hostCapabilities } from "@/shell/runtimeCapabilities";
import { ControlRow, ErrorMessages, TranscriptionOverlay, type InputMode } from "./voicetree-transcribe/presentation";

export default function VoiceTreeTranscribe(): JSX.Element {
  // Ask-mode needs a semantic backend + a context-node-from-question spawn path
  // the browser host lacks; hide the toggle there rather than silently no-op.
  const canAskMode: boolean = hostCapabilities().askMode;
  const [textInput, setTextInput] = useState("");
  const [backendPort, setBackendPort] = useState<number | undefined>(undefined);
  const [isTranscriptionExpanded, setIsTranscriptionExpanded] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    const stored: string | null = localStorage.getItem('voicetree-input-mode');
    if (stored === 'ask') return canAskMode ? 'ask' : null;  // don't restore a gated mode
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
    window.hostAPI?.main.getBackendPort().then((port: number | null) => {
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
    const status = await window.hostAPI?.main.checkMicrophonePermission();

    if (status === 'not-determined') {
      // First time - show native permission dialog
      const granted = await window.hostAPI?.main.requestMicrophonePermission();
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
        await window.hostAPI?.main.askQuery(question, 10);

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
        const graph: { nodes: Record<string, unknown> } | undefined = await window.hostAPI?.main.getGraph();
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
      const result: unknown = await window.hostAPI?.main.askModeCreateAndSpawn(nodePaths, question);

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
            canAskMode={canAskMode}
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
            // Only show the OS-settings deep-link when the host can actually open
            // it (native mac). The browser controls mic access via site-settings.
            isMacPlatform={navigator.platform.includes('Mac') && hostCapabilities().nativeMicrophoneSettings}
            micPermissionDenied={micPermissionDenied}
            onOpenMicrophoneSettings={() => { void window.hostAPI?.main.openMicrophoneSettings() }}
          />
        </div>
      </div>
    </div>
  );
}
