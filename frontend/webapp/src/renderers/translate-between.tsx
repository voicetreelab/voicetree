import { useEffect, useState } from "react";
import StatusDisplay from "../components/status-display";
import RecordButton from "../components/record-button";
import { getLanguage, type Language, languages } from "../config/languages";
import useSonioxClient from "@/hooks/useSonioxClient";
import getAPIKey from "@/utils/get-api-key";
import Renderer from "./renderer";
import useAutoScroll from "@/hooks/useAutoScroll";
import { isActiveState } from "@soniox/speech-to-text-web";

export default function TranslateBetween() {
  const [languageA, setLanguageA] = useState<Language>(getLanguage("en"));
  const [languageB, setLanguageB] = useState<Language>(getLanguage("es"));

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
      type: "two_way",
      language_a: languageA.code,
      language_b: languageB.code,
    },
  });

  useEffect(() => {
    stopTranscription();
  }, [languageA, languageB, stopTranscription]);

  const allTokens = [...finalTokens, ...nonFinalTokens];
  const leftContainerAutoScrollRef = useAutoScroll(allTokens);
  const rightContainerAutoScrollRef = useAutoScroll(allTokens);

  const languageATokens = allTokens.filter(
    (token) => token.language === languageA.code,
  );
  const languageBTokens = allTokens.filter(
    (token) => token.language === languageB.code,
  );

  return (
    <div className="bg-[#f2f2f2] rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Translate Between
        </h2>
        <StatusDisplay state={state} />
      </div>

      {/* Language A selector */}
      <div className="mb-4">
        <label
          htmlFor="language-a"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Language A:
        </label>
        <select
          id="language-a"
          value={languageA.code}
          disabled={isActiveState(state)}
          onChange={(e) => {
            setLanguageA(getLanguage(e.target.value));
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

      {/* Language B selector */}
      <div className="mb-4">
        <label
          htmlFor="language-b"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Language B:
        </label>
        <select
          id="language-b"
          value={languageB.code}
          disabled={isActiveState(state)}
          onChange={(e) => {
            setLanguageB(getLanguage(e.target.value));
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
        {/* Language A Box */}
        <div className="border rounded-lg bg-white p-4">
          <div className="text-sm font-semibold text-gray-700 text-center mb-2">
            {languageA.name}
          </div>
          <div
            ref={leftContainerAutoScrollRef}
            className="h-[400px] overflow-y-auto"
          >
            <Renderer
              tokens={languageATokens}
              placeholder={`${languageA.name} will appear here...`}
            />
          </div>
        </div>

        {/* Language B Box */}
        <div className="border rounded-lg bg-white p-4">
          <div className="text-sm font-semibold text-gray-700 text-center mb-2">
            {languageB.name}
          </div>
          <div
            ref={rightContainerAutoScrollRef}
            className="h-[400px] overflow-y-auto"
          >
            <Renderer
              tokens={languageBTokens}
              placeholder={`${languageB.name} will appear here...`}
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
