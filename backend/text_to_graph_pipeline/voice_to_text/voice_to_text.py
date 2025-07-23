import logging
import time
import threading
from queue import Queue, Empty

import numpy as np
import pyaudio
import webrtcvad
from faster_whisper import WhisperModel

from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig


class VoiceToTextEngine:
    """
    A high-accuracy, real-time voice-to-text engine that conforms to the
    start_listening() and process_audio_queue() API.

    It uses a background thread for audio capture and VAD, and the main thread
    (via process_audio_queue) for transcription.
    """
    def __init__(self, config: VoiceConfig = None):
        self.config = config or VoiceConfig()

        print(f"Loading Whisper model '{self.config.model_size}'...")
        self.model = WhisperModel(
            self.config.model_size,
            device=self.config.device,
            compute_type=self.config.compute_type
        )
        logging.info("Whisper model loaded.")

        self.vad = webrtcvad.Vad(self.config.vad_aggressiveness)

        # This internal queue holds complete, VAD-detected audio chunks ready for transcription.
        self._ready_for_transcription_queue = Queue()

        # State management for the background audio capture thread
        self._stop_event = threading.Event()
        self._audio_capture_thread = None

        # Context management for higher accuracy
        self.transcription_history = []

        # Derived constant from config for easier use
        self.chunk_size = int(self.config.sample_rate * self.config.vad_frame_ms / 1000)

    def start_listening(self):
        """Starts the background audio capture and VAD thread."""
        if self._audio_capture_thread is not None:
            logging.warning("Audio capture thread is already running.")
            return

        self._stop_event.clear()
        self._audio_capture_thread = threading.Thread(target=self._audio_capture_loop)
        self._audio_capture_thread.daemon = True
        self._audio_capture_thread.start()
        logging.info("Background audio capture started.")

    def stop(self):
        """Stops the background audio capture thread gracefully."""
        if self._audio_capture_thread is None:
            return

        self._stop_event.set()
        self._audio_capture_thread.join()
        self._audio_capture_thread = None
        logging.info("Background audio capture stopped.")

    def _audio_capture_loop(self):
        """
        The main loop for the background thread.
        Captures audio, uses VAD to detect speech, and puts complete utterances
        into a queue for the main thread to process.
        """
        p = pyaudio.PyAudio()
        stream = p.open(format=pyaudio.paInt16,
                        channels=self.config.audio_channels,
                        rate=self.config.sample_rate,
                        input=True,
                        frames_per_buffer=self.chunk_size)

        padding_frames_count = self.config.vad_padding_ms // self.config.vad_frame_ms
        silence_timeout_frames = self.config.vad_silence_timeout_ms // self.config.vad_frame_ms

        is_speaking = False
        silent_frames_count = 0
        audio_frames = []

        logging.info("Listening for speech...")
        while not self._stop_event.is_set():
            try:
                frame = stream.read(self.chunk_size, exception_on_overflow=False)
                is_speech = self.vad.is_speech(frame, self.config.sample_rate)

                if is_speaking:
                    audio_frames.append(frame)
                    if not is_speech:
                        silent_frames_count += 1
                        if silent_frames_count >= silence_timeout_frames:
                            # Silence detected, utterance is complete.
                            audio_data_bytes = b''.join(audio_frames)
                            audio_np = np.frombuffer(audio_data_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                            self._ready_for_transcription_queue.put(audio_np)

                            # Reset for next utterance
                            audio_frames.clear()
                            is_speaking = False
                    else:
                        silent_frames_count = 0
                elif is_speech:
                    # Start of speech detected
                    is_speaking = True
                    silent_frames_count = 0
                    # Add padding to the beginning of the speech
                    padding_frames = [frame] * padding_frames_count
                    audio_frames.extend(padding_frames)

            except Exception as e:
                logging.error(f"Error in audio capture loop: {e}")
                time.sleep(1)

        stream.stop_stream()
        stream.close()
        p.terminate()

    def process_audio_queue(self):
        """
        Processes one complete audio chunk from the internal queue if available.
        This method is designed to be called repeatedly in a loop by the main thread.
        """
        try:
            # Get a complete audio chunk detected by the background VAD thread.
            audio_np = self._ready_for_transcription_queue.get_nowait()
        except Empty:
            # No complete utterance is ready for transcription.
            return None

        # A chunk is available, so we transcribe it.
        logging.info(f"Transcribing {len(audio_np)/self.config.sample_rate:.2f}s of audio...")
        try:
            prompt = " ".join(self.transcription_history)

            segments, _ = self.model.transcribe(
                audio_np,
                beam_size=self.config.beam_size,
                language=self.config.language,
                word_timestamps=self.config.word_timestamps,
                condition_on_previous_text=self.config.condition_on_previous_text,
                initial_prompt=prompt,
                vad_filter=self.config.use_vad_filter,
            )

            full_text = "".join(segment.text.strip() + " " for segment in segments)
            final_text = full_text.strip()

            if final_text:
                logging.info(f"Transcription result: {final_text}")

                # Update context history for the next transcription
                self.transcription_history.append(final_text)
                if len(self.transcription_history) > self.config.history_max_size:
                    self.transcription_history.pop(0)
                print(final_text)
                return final_text

        except Exception as e:
            logging.error(f"Error during transcription: {e}")

        return None


if __name__ == '__main__':
    # This is a simple synchronous example to test the class directly.
    # It mimics the behavior of your main.py loop.
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    engine = VoiceToTextEngine()
    engine.start_listening()

    print("\nSpeak into your microphone. The engine will transcribe when you pause.")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            transcription = engine.process_audio_queue()
            if transcription:
                print(">>", transcription)
            time.sleep(0.1) # Prevent busy-waiting
    except KeyboardInterrupt:
        print("\nStopping engine...")
        engine.stop()
        print("Engine stopped.")