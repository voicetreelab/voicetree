import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#001227cc] via-[#0a59bbcc] to-[#ffffffcc] p-4">
      <div className="max-w-4xl mx-auto">
        <VoiceTreeTranscribe />
      </div>
    </div>
  );
}

export default App;
