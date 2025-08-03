import logging
import time
from queue import Queue, Empty

import numpy as np
import speech_recognition as sr
from faster_whisper import WhisperModel

# Make sure your VoiceConfig is updated as recommended in the previous answer
from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig

logging.getLogger("faster_whisper").setLevel(logging.WARN)
# You can set the logging level for speech_recognition to WARN to quiet it down
logging.getLogger("speech_recognition").setLevel(logging.WARN)


class VoiceToTextEngine:
    """
    A robust, real-time voice-to-text engine using speech_recognition for VAD
    and faster-whisper for transcription.

    This architecture correctly uses each library for its intended purpose:
    1. speech_recognition: Captures audio and uses its dynamic energy VAD to
       detect complete spoken phrases.
    2. Queue: Acts as a simple, thread-safe buffer for these complete phrases.
    3. faster-whisper: Transcribes one complete phrase at a time for maximum accuracy.
    """
    def __init__(self, config: VoiceConfig = None):
        self.config = config or VoiceConfig()

        print(f"Loading Whisper model '{self.config.model_size}'...")
        # Use the correct model name from your config
        self.model = WhisperModel(
            self.config.model_size,
            device=self.config.device,
            compute_type=self.config.compute_type,
            cpu_threads=self.config.cpu_threads
        )
        logging.info("Whisper model loaded.")

        self.recorder = sr.Recognizer()
        self.recorder.pause_threshold = self.config.pause_threshold
        self.recorder.energy_threshold = self.config.energy_threshold
        self.recorder.dynamic_energy_threshold = self.config.dynamic_energy_threshold
        self.recorder.dynamic_energy_ratio = self.config.dynamic_energy_ratio

        # This queue will hold complete audio phrases (as numpy arrays) ready for transcription.
        self._ready_for_transcription_queue = Queue()

        self._stop_listening_callback = None
        self.source = None

    def _audio_data_callback(self, recognizer, audio_data: sr.AudioData):
        """
        Callback from the listener thread.
        It receives a complete phrase and puts it on the queue.
        """
        logging.info("Phrase detected by VAD, adding to transcription queue.")
        raw_data = audio_data.get_raw_data()
        audio_np = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768.0
        self._ready_for_transcription_queue.put(audio_np)

    def start_listening(self):
        """Starts the background audio capture and VAD."""
        if self._stop_listening_callback is not None:
            logging.warning("Audio capture is already running.")
            return

        self.source = sr.Microphone(sample_rate=self.config.sample_rate)

        with self.source:
            logging.info("Calibrating for ambient noise... Please be quiet for a moment.")
            self.recorder.adjust_for_ambient_noise(self.source, duration=1.0)
            logging.info(f"Calibration complete. Energy threshold: {self.recorder.energy_threshold:.2f}")

        # listen_in_background handles all the threading and VAD logic internally.
        self._stop_listening_callback = self.recorder.listen_in_background(
            self.source,
            self._audio_data_callback,
            phrase_time_limit=self.config.phrase_time_limit
        )
        print("Ready to listen")
        logging.info("Listening in the background...")

    def stop(self):
        """Stops the background audio capture."""
        if self._stop_listening_callback:
            self._stop_listening_callback(wait_for_stop=False)
            self._stop_listening_callback = None
            self.source = None
            logging.info("Background audio capture stopped.")

    def get_ready_audio_chunk(self):
        """
        Non-blocking method to get a VAD-detected audio chunk if available.
        This is the intended way to interact with the engine from your main loop.
        """
        try:
            return self._ready_for_transcription_queue.get_nowait()
        except Empty:
            return None

    def transcribe_chunk(self, audio_np):
        """
        Synchronous method to transcribe a single, complete audio chunk.
        """
        logging.info(f"Transcribing audio chunk of length: {len(audio_np)/self.config.sample_rate:.2f}s")
        try:
            # Note: A lot of the parameters from your old code's transcribe call
            # are now set in the config. Let's make sure they are used here.
            segments, _ = self.model.transcribe(
                audio_np,
                beam_size=self.config.beam_size,
                language=self.config.language,
                word_timestamps=self.config.word_timestamps,
                condition_on_previous_text=self.config.condition_on_previous_text,
                vad_filter=self.config.use_vad_filter,
                vad_parameters=dict(min_silence_duration_ms=self.config.MIN_SILENCE_DURATION_MS)
            )

            full_text = "".join(segment.text for segment in segments).strip()

            if full_text:
                print(f"Transcribed: {full_text}")
                logging.info(f"Transcription result: {full_text}")
            else:
                logging.warning("No text transcribed from audio chunk.")

            return full_text

        except Exception as e:
            logging.error(f"Error during transcription: {e}", exc_info=True)
            return ""