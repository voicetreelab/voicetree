import type { JSX, KeyboardEvent, RefObject } from "react";
import type { RecorderState } from "@soniox/speech-to-text-web";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/lib/utils";
import AnimatedMicIcon from "@/shell/UI/views/components/animated-mic-icon";
import StatusDisplay from "@/shell/UI/views/components/status-display";
import { TranscriptionDisplay } from "@/shell/UI/views/ui-controls/TranscriptionDisplay";

export type InputMode = 'add' | 'ask' | null;

export type TranscriptionErrorMessage = {
  readonly message: string;
};

interface TranscriptionOverlayProps {
  readonly hasTranscriptionText: boolean;
  readonly isTranscriptionExpanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
}

interface ControlRowProps {
  readonly canAskMode: boolean;
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

export function TranscriptionOverlay({
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

export function ControlRow({
  canAskMode,
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
      {/* Ask-mode pill — hidden when the host can't serve ask-mode (browser). */}
      {canAskMode && (
        <>
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
        </>
      )}
    </div>
  );
}

export function ErrorMessages({
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
