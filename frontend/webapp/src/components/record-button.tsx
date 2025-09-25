import { type RecorderState } from "@soniox/speech-to-text-web";
import { isActiveState } from "@soniox/speech-to-text-web";

interface RecordButtonProps {
  state: RecorderState;
  stopTranscription: () => void;
  startTranscription: () => void;
  compact?: boolean;
}

export default function RecordButton({
  state,
  stopTranscription,
  startTranscription,
  compact = false,
}: RecordButtonProps) {
  return (
    <div className="text-center">
      {isActiveState(state) ? (
        <button
          className={compact
            ? "w-12 h-12 text-xl cursor-pointer bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            : "px-6 text-md font-bold cursor-pointer py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          }
          onClick={stopTranscription}
          disabled={state === "FinishingProcessing"}
        >
          {compact
            ? "⏹️"
            : (state === "FinishingProcessing" ? "Finishing..." : "Stop Recording")
          }
        </button>
      ) : (
        <button
          className={compact
            ? "w-12 h-12 text-xl cursor-pointer bg-voicetree text-white rounded-full hover:bg-voicetree/80 flex items-center justify-center"
            : "px-6 text-md font-bold cursor-pointer py-2 bg-voicetree text-white rounded-lg hover:bg-voicetree/80"
          }
          onClick={startTranscription}
        >
          {compact ? "🎤" : "Start Recording"}
        </button>
      )}
    </div>
  );
}
