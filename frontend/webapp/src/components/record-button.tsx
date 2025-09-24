import { type RecorderState } from "@soniox/speech-to-text-web";
import { isActiveState } from "@soniox/speech-to-text-web";

interface RecordButtonProps {
  state: RecorderState;
  stopTranscription: () => void;
  startTranscription: () => void;
}

export default function RecordButton({
  state,
  stopTranscription,
  startTranscription,
}: RecordButtonProps) {
  return (
    <div className="text-center">
      {isActiveState(state) ? (
        <button
          className="px-6 text-md font-bold cursor-pointer py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={stopTranscription}
          disabled={state === "FinishingProcessing"}
        >
          {state === "FinishingProcessing" ? "Finishing..." : "Stop Recording"}
        </button>
      ) : (
        <button
          className="px-6 text-md font-bold cursor-pointer py-2 bg-soniox text-white rounded-lg hover:bg-soniox/80"
          onClick={startTranscription}
        >
          Start Recording
        </button>
      )}
    </div>
  );
}
