import logging

import speech_recognition as sr
from faster_whisper import WhisperModel
import numpy as np
import asyncio
from datetime import datetime, timedelta
from queue import Queue

try:
    import settings
except ImportError:
    # Fallback settings for testing
    class MockSettings:
        VOICE_MODEL = "base"
    settings = MockSettings()

# Optional pyaudio import with auto-installation - only needed for live microphone recording
try:
    import pyaudio
    PYAUDIO_AVAILABLE = True
except ImportError:
    PYAUDIO_AVAILABLE = False
    logging.info("PyAudio not available - will auto-install when needed for live recording.")


def _ensure_pyaudio_installed():
    """
    Auto-install pyaudio when needed for live recording.
    This keeps it out of requirements.txt for CI compatibility.
    """
    global PYAUDIO_AVAILABLE
    
    if PYAUDIO_AVAILABLE:
        return True
    
    try:
        import subprocess
        import sys
        
        logging.info("🔧 Installing PyAudio for live audio recording...")
        print("📦 Installing PyAudio (needed for live microphone recording)...")
        
        # Try to install pyaudio
        result = subprocess.run([
            sys.executable, "-m", "pip", "install", "pyaudio"
        ], capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            # Try to import again
            import pyaudio
            PYAUDIO_AVAILABLE = True
            logging.info("✅ PyAudio installed successfully!")
            print("✅ PyAudio installed successfully!")
            return True
        else:
            logging.error(f"❌ Failed to install PyAudio: {result.stderr}")
            print(f"❌ Failed to install PyAudio: {result.stderr}")
            print("💡 You may need to install system dependencies first:")
            print("   Ubuntu/Debian: sudo apt-get install portaudio19-dev")
            print("   macOS: brew install portaudio")
            print("   Windows: Usually works without extra dependencies")
            return False
            
    except Exception as e:
        logging.error(f"❌ Error installing PyAudio: {e}")
        print(f"❌ Error installing PyAudio: {e}")
        return False


class VoiceToTextEngine:
    def __init__(self, whisper_model_name=settings.VOICE_MODEL,
                 energy_threshold=1000, record_timeout=2, phrase_timeout=1,
                 default_microphone='pulse', audio_file_path=None):
        """
        Initialize VoiceToText engine
        
        Args:
            whisper_model_name: Whisper model to use
            energy_threshold: Energy threshold for recording
            record_timeout: Recording timeout in seconds
            phrase_timeout: Phrase timeout in seconds
            default_microphone: Default microphone setting
            audio_file_path: Optional path to audio file for testing (instead of live recording)
        """
        self.recorder = sr.Recognizer()
        self.recorder.energy_threshold = energy_threshold
        self.recorder.dynamic_energy_threshold = False
        self.audio_model = WhisperModel(whisper_model_name, device="cpu", compute_type="int8")
        self.record_timeout = record_timeout
        self.phrase_timeout = phrase_timeout
        self.default_microphone = default_microphone
        self.audio_file_path = audio_file_path  # For testing with pre-recorded audio

        self.phrase_time = None
        self.data_queue = Queue()
        self.transcription = ['']

    def start_listening(self):
        """Starts continuous listening in the background."""
        # Auto-install pyaudio if needed
        if not _ensure_pyaudio_installed():
            raise RuntimeError(
                "PyAudio installation failed. Cannot start live recording.\n"
                "Alternative: Use process_audio_file() for testing with audio files."
            )
        
        source = sr.Microphone(sample_rate=16000)
        with source:
            self.recorder.adjust_for_ambient_noise(source)
        print("Model loaded.\n")

        self.recorder.listen_in_background(source, self.record_callback, phrase_time_limit=self.record_timeout)

    def process_audio_file(self, audio_file_path: str) -> str:
        """
        Process audio from a file instead of live recording - perfect for CI/testing!
        Supports multiple formats: .wav, .mp3, .mp4, .m4a, .flac, etc.
        
        Args:
            audio_file_path: Path to audio file (.wav, .mp3, .mp4, .m4a, etc.)
            
        Returns:
            Transcribed text from the audio file
        """
        try:
            import os
            if not os.path.exists(audio_file_path):
                logging.error(f"Audio file not found: {audio_file_path}")
                return ""
            
            logging.info(f"Processing audio file: {audio_file_path}")
            
            # Use Whisper directly for better format support (handles .m4a, .mp4, etc.)
            result, info = self.audio_model.transcribe(audio_file_path, language="en")
            
            text = ""
            for segment in result:
                text += segment.text.strip() + " "
            
            logging.info(f"Transcribed audio file {audio_file_path}: {len(text)} characters")
            print(f"🎵 Transcribed {os.path.basename(audio_file_path)}: {len(text)} characters")
            return text.strip()
                
        except Exception as e:
            logging.error(f"Error processing audio file {audio_file_path}: {e}")
            print(f"❌ Error processing audio file {audio_file_path}: {e}")
            return ""

    def process_audio_queue(self):
        """Processes audio chunks from the queue."""
        if not self.data_queue.empty():
            phrase_complete = False
            now = datetime.utcnow()
            if self.phrase_time and now - self.phrase_time > timedelta(seconds=self.phrase_timeout):
                phrase_complete = True
            self.phrase_time = now

            audio_data = b''.join(self.data_queue.queue)
            self.data_queue.queue.clear()

            audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
            result, info = self.audio_model.transcribe(audio_np, language="en")
            text = ""

            for segment in result:
                print(segment.text)
                logging.info(f"Transcribed segment: {text}")
                text += segment.text.strip()
            logging.info("Phrase complete? "+str(phrase_complete))
            # if phrase_complete:
            #todo, thought end detection based on time not speaking...
            return text
        return None

    def record_callback(self, _, audio: sr.AudioData):
        """Callback for audio data from SpeechRecognizer."""
        data = audio.get_raw_data()
        self.data_queue.put(data)
