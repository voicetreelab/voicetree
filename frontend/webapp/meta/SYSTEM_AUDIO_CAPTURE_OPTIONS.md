# System Audio + Microphone Capture in Electron on macOS

## Problem Statement

Current implementation only captures microphone input via `getUserMedia()`. For meeting recordings (e.g., Zoom calls), we need to capture:
1. **Microphone** - user speaking
2. **System audio** - what the computer is playing (other participants, application sounds)

## Current Implementation

Location: `src/shell/UI/renderers/voicetree-transcribe.tsx:153`

```typescript
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false
  }
})
```

This only captures microphone, not system audio.

## Key Constraint: macOS Limitations

**Critical**: Standard web APIs like `getDisplayMedia()` do NOT capture system audio on macOS. They only work for:
- Tab audio (when sharing a Chrome tab)
- NOT system-wide audio from applications like Zoom, Spotify, etc.

On Windows this works, but macOS has strict restrictions.

## Solution Options

### Option 1: Chromium Built-in Loopback (MacLoopbackAudioForScreenShare)

**How it works**: Enable Chromium flags to access system audio loopback

**Requirements**:
- macOS 13+
- Electron with proper code signing
- "Screen & System Audio Recording" permission
- **Only works for audio-only capture** (macOS bug prevents video + audio simultaneously)

**Implementation**:

```typescript
// In main process (src/shell/edge/main/electron/main.ts)
import { app, session, desktopCapturer } from 'electron';

// Enable Chromium flags
app.commandLine.appendSwitch('enable-features',
  'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// Set up display media handler
app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({
        video: sources[0],  // Can be omitted for audio-only
        audio: 'loopback'   // This enables system audio capture
      });
    });
  });
});
```

```typescript
// In renderer process
const systemStream = await navigator.mediaDevices.getDisplayMedia({
  audio: true,
  video: false  // Audio-only to avoid macOS bug
});

const micStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false
  }
});

// Mix both streams using Web Audio API
const audioContext = new AudioContext();
const systemSource = audioContext.createMediaStreamSource(systemStream);
const micSource = audioContext.createMediaStreamSource(micStream);
const destination = audioContext.createMediaStreamDestination();

systemSource.connect(destination);
micSource.connect(destination);

// Pass destination.stream to Soniox
const combinedStream = destination.stream;
```

**Pros**:
- No external dependencies
- Built into Chromium/Electron
- Works on macOS 13+

**Cons**:
- Requires app restart after granting permission (poor UX)
- Shows purple "screen recording" indicator even for audio-only (confusing)
- Preview shows entire desktop (privacy concern)
- Captures post-mixer audio (affected by system volume - muted = no audio)
- Requires proper code signing

**Verdict**: Works but has significant UX issues for production apps.

---

### Option 2: AudioTee.js (Core Audio Taps API)

**How it works**: Uses macOS 14.2+ native Core Audio Taps API via a Swift binary wrapper

**Requirements**:
- macOS 14.2+
- Bundle Swift binary with app
- "System Audio Recording Only" permission (no restart needed)

**Implementation**:

```bash
npm install audiotee
```

```typescript
// In main process or preload - expose AudioTee
import AudioTee from 'audiotee';

// Expose in preload.ts
const electronAPI: ElectronAPI = {
  // ... existing code ...

  audio: {
    startSystemAudioCapture: async () => {
      const audioTee = new AudioTee();
      await audioTee.start();
      return audioTee;
    }
  }
};
```

```typescript
// In renderer
const audioTee = await window.electronAPI.audio.startSystemAudioCapture();

audioTee.on('data', (pcmBuffer) => {
  // System audio PCM data
  // Convert to MediaStream and mix with mic
});

// Also capture mic
const micStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false
  }
});

// Mix both streams (requires converting PCM to MediaStream)
```

**Pros**:
- Only needs "Audio Recording" permission (no restart)
- No misleading screen recording indicator
- Captures pre-mixer audio (clean, unaffected by system volume)
- Better UX than Chromium approach

**Cons**:
- Requires macOS 14.2+ (newer than Chromium approach)
- Must bundle Swift binary with app
- More complex setup
- Need to convert PCM data to MediaStream for Soniox

**Verdict**: Best native solution for macOS 14.2+ users, cleaner UX.

---

### Option 3: BlackHole Virtual Audio Device

**How it works**: User installs a virtual audio device that captures system audio, then app selects it as an input

**Requirements**:
- User manually installs BlackHole (https://github.com/ExistentialAudio/BlackHole)
- User configures macOS Audio MIDI Setup to route audio
- Standard audio permissions (no special permissions)

**Implementation**:

```typescript
// In renderer - detect BlackHole device
const devices = await navigator.mediaDevices.enumerateDevices();
const audioInputs = devices.filter(d => d.kind === 'audioinput');

// Find BlackHole or other virtual devices
const blackhole = audioInputs.find(d =>
  d.label.toLowerCase().includes('blackhole') ||
  d.label.toLowerCase().includes('soundflower')
);

if (blackhole) {
  // Capture system audio via virtual device
  const systemStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: blackhole.deviceId }
  });

  // Capture mic
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false
    }
  });

  // Mix both streams
  const audioContext = new AudioContext();
  const systemSource = audioContext.createMediaStreamSource(systemStream);
  const micSource = audioContext.createMediaStreamSource(micStream);
  const destination = audioContext.createMediaStreamDestination();

  systemSource.connect(destination);
  micSource.connect(destination);

  // Pass to Soniox
  const combinedStream = destination.stream;
} else {
  alert('BlackHole not detected. Please install BlackHole for system audio capture.');
}
```

**User Setup (one-time)**:
1. Install BlackHole: `brew install blackhole-2ch`
2. Open Audio MIDI Setup
3. Create Multi-Output Device combining BlackHole + Built-in Output
4. Set Multi-Output as system default
5. BlackHole now appears as input device in apps

**Pros**:
- Simplest implementation (standard Web Audio API)
- No Electron-specific code
- No special permissions beyond standard microphone
- Works on any macOS version
- Captures pre-mixer audio (clean)

**Cons**:
- Requires user to install external software
- One-time manual setup (5 minutes)
- Relies on third-party software

**Verdict**: Easiest to implement, good for MVP. Can be improved later with native solutions.

---

## Recommendations

### For MVP / Quick Implementation
**Use Option 3 (BlackHole)**
- Implement in 30 minutes
- Works reliably
- Document setup process for users
- Can always add native solutions later

### For Production / Better UX
**Use Option 2 (AudioTee.js)** if targeting macOS 14.2+
- Best UX (no restart, clear permissions)
- Native implementation
- Clean audio capture

**Use Option 1 (Chromium)** if need macOS 13 support
- Works on older macOS
- But accept the UX tradeoffs

### Hybrid Approach
1. Detect macOS version
2. Use AudioTee.js on 14.2+
3. Fall back to BlackHole detection on older versions
4. Provide setup instructions if neither available

## Next Steps

1. **Immediate**: Implement BlackHole detection in `voicetree-transcribe.tsx`
2. **Phase 2**: Add UI toggle for "System Audio + Mic" vs "Mic Only"
3. **Phase 3**: Consider AudioTee.js for native implementation
4. **Testing**: Verify Soniox SDK accepts custom MediaStream (check their docs)

## Related Files

- `src/shell/UI/renderers/voicetree-transcribe.tsx` - Main audio capture UI
- `src/shell/UI/hooks/useVoiceTreeClient.tsx` - Soniox client wrapper
- `src/shell/edge/main/electron/preload.ts` - Electron API exposure

## References

- [BlackHole GitHub](https://github.com/ExistentialAudio/BlackHole)
- [AudioTee.js npm](https://www.npmjs.com/package/audiotee)
- [Chromium Loopback Article](https://alec.is/posts/bringing-system-audio-loopback-to-electron/)
- [Comparison Article](https://stronglytyped.uk/articles/recording-system-audio-electron-macos-approaches)
