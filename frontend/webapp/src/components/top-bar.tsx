import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusDisplay from "./status-display";
import SoundWaveVisualizer from "./sound-wave-visualizer";
import { type RecorderState } from "@soniox/speech-to-text-web";

interface HistoryEntry {
  id: string;
  text: string;
  timestamp: Date;
  source: 'speech' | 'text';
}

interface TopBarProps {
  state: RecorderState;
  currentTranscript: string;
  bufferLength: number;
  isProcessing: boolean;
  connectionError: string | null;
  error: any;
  history: HistoryEntry[];
  onStartTranscription: () => void;
  onStopTranscription: () => void;
  onSendText: (text: string) => void;
  onClearHistory: () => void;
}

export default function TopBar({
  state,
  currentTranscript,
  bufferLength,
  isProcessing,
  connectionError,
  error,
  history,
  onStartTranscription,
  onStopTranscription,
  onSendText,
  onClearHistory
}: TopBarProps) {
  const [textInput, setTextInput] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const historyScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll history
  useEffect(() => {
    if (historyScrollRef.current && history.length > 0) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
    }
  }, [history]);

  const handleTextSubmit = () => {
    if (textInput.trim()) {
      onSendText(textInput);
      setTextInput("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-b">
      <div className="flex flex-col h-28">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-1 text-xs border-b bg-muted/30">
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              History {showHistory ? '▼' : '▶'}
            </button>
            {history.length > 0 && (
              <button
                onClick={onClearHistory}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title="Clear history"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* History Section (collapsible) */}
        {showHistory && (
          <div
            ref={historyScrollRef}
            className="flex-1 overflow-y-auto px-4 py-2 min-h-0 bg-muted/10"
          >
            {history.length === 0 ? (
              <div className="text-muted-foreground text-xs text-center py-2">
                No history yet...
              </div>
            ) : (
              <div className="flex gap-2 pb-1">
                {history.slice(-5).map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-card rounded-md px-2 py-1 text-xs border shadow-sm animate-fade-in max-w-[200px]"
                  >
                    <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                      <span>{entry.source === 'speech' ? '🎤' : '⌨️'}</span>
                      <span className="text-[10px]">
                        {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="truncate text-foreground">{entry.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input Section */}
        <div className="flex items-center gap-2 px-4 py-2">
          {/* Mic Button */}
          <button
            onClick={state === 'Running' ? onStopTranscription : onStartTranscription}
            className={cn(
              "p-2 rounded-lg transition-all",
              state === 'Running'
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {state === 'Running' ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {/* Text Input with overlay */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={textInput || (state === 'Running' ? currentTranscript : '')}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={state === 'Running' ? "Listening..." : "Type or speak your message..."}
              className={cn(
                "w-full px-3 py-2 text-sm rounded-lg border bg-background transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                state === 'Running'
                  ? "bg-primary/5 border-primary/30"
                  : "border-input hover:border-accent-foreground/20"
              )}
              disabled={isProcessing || state === 'Running'}
            />

            {/* Sound Wave Visualization Overlay */}
            {state === 'Running' && (
              <div className="absolute inset-0 pointer-events-none flex items-center px-3">
                <div className="w-full h-4 opacity-20">
                  <SoundWaveVisualizer
                    isActive={state === 'Running'}
                    fallbackAnimation={true}
                    barCount={40}
                    barColor="hsl(var(--primary))"
                    className="w-full h-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Send Button */}
          <button
            onClick={handleTextSubmit}
            disabled={isProcessing || (!textInput.trim() && state !== 'Running')}
            aria-label="Send"
            className={cn(
              "p-2 rounded-lg transition-all",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Error Messages */}
        {(error || connectionError) && (
          <div className="px-4 pb-2">
            {connectionError && (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">
                {connectionError} - Transcription continues offline
              </div>
            )}
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1 mt-1">
                {error.message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}