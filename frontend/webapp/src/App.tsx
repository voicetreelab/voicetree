import VoiceTreeLayout from "./components/voicetree-layout";
import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";
import Sidebar from "./components/sidebar";

function App() {
  // Show both components so we can compare them
  const showBoth = true;

  if (showBoth) {
    return (
      <div className="min-h-screen bg-background">
        <div className="grid grid-cols-1 gap-4 p-4">
            {/* Above - VoiceTreeTranscribe */}
            <div>
                <h2 className="text-lg font-bold mb-2">VoiceTreeTranscribe Component</h2>
                <VoiceTreeTranscribe />
            </div>
          {/* Left side - Original with Sidebar */}
          <div className="border-r pr-4">
            <Sidebar>
              <VoiceTreeLayout />
            </Sidebar>
          </div>


        </div>
      </div>
    );
  }

  // Original code
  return (
    <Sidebar>
      <VoiceTreeLayout />
    </Sidebar>
  );
}

export default App;