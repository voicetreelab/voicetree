import { useEffect, useState } from "react";
import StatusDisplay from "../components/status-display";
import RecordButton from "../components/record-button";
import { getLanguage, languages, type Language } from "../config/languages";
import useSonioxClient from "@/hooks/useSonioxClient";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";
import { isActiveState } from "@soniox/speech-to-text-web";

export default function TranslateFromTo() {
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(
    getLanguage("es"),
  );

  const {
    state,
    finalTokens,
    nonFinalTokens,
    startTranscription,
    stopTranscription,
    error,
  } = useSonioxClient({
    apiKey: getAPIKey,
    translationConfig: {
      type: "one_way",
      target_language: selectedLanguage.code,
    },
  });

  useEffect(() => {
    stopTranscription();
  }, [selectedLanguage, stopTranscription]);

  const allTokens = [...finalTokens, ...nonFinalTokens];
  const leftContainerAutoScrollRef = useAutoScroll(allTokens);
  const rightContainerAutoScrollRef = useAutoScroll(allTokens);

  const sourceLanguageTokens = allTokens.filter(
    (token) => token.translation_status !== "translation",
  );
  const targetLanguageTokens = allTokens.filter(
    (token) => token.translation_status === "translation",
  );

  return (
    <div className="bg-[#f2f2f2] rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Translate From-To
        </h2>
        <StatusDisplay state={state} />
      </div>

      {/* Target language selector */}
      <div className="mb-4">
        <label
          htmlFor="target-language"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Target Language:
        </label>
        <select
          id="target-language"
          value={selectedLanguage.code}
          disabled={isActiveState(state)}
          onChange={(e) => {
            setSelectedLanguage(getLanguage(e.target.value));
          }}
          className="w-full bg-white px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-soniox focus:border-soniox"
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Source Language Box */}
        <div className="border rounded-lg bg-white p-4">
          <div className="text-sm font-semibold text-gray-700 text-center mb-2">
            All Languages
          </div>
          <div
            ref={leftContainerAutoScrollRef}
            className="h-[400px] overflow-y-auto"
          >
            <Renderer
              tokens={sourceLanguageTokens}
              placeholder="Transcription will appear here..."
            />
          </div>
        </div>

        {/* Target Language Box */}
        <div className="border rounded-lg bg-white p-4">
          <div className="text-sm font-semibold text-gray-700 text-center mb-2">
            {selectedLanguage.name}
          </div>
          <div
            ref={rightContainerAutoScrollRef}
            className="h-[400px] overflow-y-auto"
          >
            <Renderer
              tokens={targetLanguageTokens}
              placeholder="Translation will appear here..."
            />
          </div>
        </div>
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
