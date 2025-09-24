import StatusDisplay from "../components/status-display";
import RecordButton from "../components/record-button";
import useSonioxClient from "@/hooks/useSonioxClient";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";

export default function Transcribe() {
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

  return (
    <div className="bg-[#f2f2f2] rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Live Transcribe</h2>
        <StatusDisplay state={state} />
      </div>

      <div
        ref={autoScrollRef}
        className="h-[500px] overflow-y-auto p-4 border rounded-lg bg-white mb-4"
      >
        <Renderer
          tokens={allTokens}
          placeholder="Click start to begin transcribing"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div className="text-red-700 text-sm">Error: {error.message}</div>
        </div>
      )}

      <RecordButton
        state={state}
        stopTranscription={stopTranscription}
        startTranscription={startTranscription}
      />
    </div>
  );
}
