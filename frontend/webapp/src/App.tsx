import { useState } from "react";
import TabView, { type Tab } from "./components/tab-view";
import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";
import Transcribe from "./renderers/transcribe";
import TranslateFromTo from "./renderers/translate-to";
import TranslateBetween from "./renderers/translate-between";

function App() {
  const [activeTab, setActiveTab] = useState("voicetree");

  const tabs: Tab[] = [
    {
      id: "voicetree",
      label: "VoiceTree",
      content: <VoiceTreeTranscribe />,
    },
    {
      id: "transcribe",
      label: "Transcribe",
      content: <Transcribe />,
    },
    {
      id: "translate-to",
      label: "Translate From-To",
      content: <TranslateFromTo />,
    },
    {
      id: "translate-between",
      label: "Translate Between",
      content: <TranslateBetween />,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#001227cc] via-[#0a59bbcc] to-[#ffffffcc] p-4">
      <div className="max-w-4xl mx-auto">
        <TabView tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </div>
  );
}

export default App;
