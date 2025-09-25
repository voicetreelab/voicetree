import VoiceTreeLayout from "./components/voicetree-layout";
import VoiceTreeTranscribe from "./renderers/voicetree-transcribe";
import Sidebar from "./components/sidebar";

function App() {
  // Show both components so we can compare them
  const showBoth = true;

  if (showBoth) {
    return (
      <div className="min-h-screen bg-background">
        <div className="grid grid-cols-2 gap-4 p-4">
          {/* Left side - Original with Sidebar */}
          <div className="border-r pr-4">
            <h2 className="text-lg font-bold mb-2">Original (VoiceTreeLayout with Sidebar)</h2>
            <Sidebar>
              <VoiceTreeLayout />
            </Sidebar>
          </div>

          {/* Right side - VoiceTreeTranscribe */}
          <div>
            <h2 className="text-lg font-bold mb-2">VoiceTreeTranscribe Component</h2>
            <VoiceTreeTranscribe />
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