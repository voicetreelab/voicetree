import logging
import time
import threading
from queue import Queue, Empty
from collections import deque

import numpy as np
import pyaudio
import webrtcvad
from faster_whisper import WhisperModel

from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig

logging.getLogger("faster_whisper").setLevel(logging.WARN)

class VoiceToTextEngine:
    """
    A high-accuracy, real-time voice-to-text engine that conforms to the
    start_listening() and process_audio_queue() API.

    It uses a background thread for audio capture and VAD, and the main thread
    (via process_audio_queue) for transcription.
    """
    def __init__(self, config: VoiceConfig = None):
        self.model_failed_last_transcription = False
        self.config = config or VoiceConfig()

        print(f"Loading Whisper model '{self.config.model_size}'...")
        self.model = WhisperModel(
            self.config.model_size,
            device=self.config.device,
            compute_type=self.config.compute_type,
            cpu_threads=self.config.cpu_threads
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
        silence_timeout_frames_orig = self.config.vad_silence_timeout_ms // self.config.vad_frame_ms
        max_frames_til_force_flush = self.config.vad_total_timeout_ms // self.config.vad_frame_ms
        max_frames_til_encourage_flush = max_frames_til_force_flush // 2

        min_speaking_frames = 1000 // self.config.vad_frame_ms

        is_speaking = False
        silent_frames_count = 0
        speaking_frames_count = 0
        audio_frames = []
        
        # Circular buffer to store recent frames for padding
        recent_frames = deque(maxlen=padding_frames_count)
        
        silence_timeout_frames = silence_timeout_frames_orig

        logging.info("Listening for speech...")
        while not self._stop_event.is_set():
            try:
                frame = stream.read(self.chunk_size, exception_on_overflow=False)
                is_speech = self.vad.is_speech(frame, self.config.sample_rate)

                if is_speaking:
                    audio_frames.append(frame)
                    speaking_frames_count += 1
                    
                    if not is_speech:
                        silent_frames_count += 1
                        # Check if we should flush due to silence or timeout
                        if (speaking_frames_count >
                                max_frames_til_encourage_flush) and \
                                silence_timeout_frames == silence_timeout_frames_orig:
                            silence_timeout_frames = silence_timeout_frames_orig // 2
                            max_frames_til_encourage_flush*=2
                            logging.info(f"ENCOURAGING FLUSH, dropping SILENCE TIMEOUT to {silence_timeout_frames} frames")

                        # we also want a minimum amount of speaking frames,
                        # otherwise we can send only one word/half a word to whisper not good.
                        if speaking_frames_count > min_speaking_frames and silent_frames_count >= silence_timeout_frames:
                            # Silence detected or forced timeout, utterance is complete.
                            logging.info(f"FLUSHING, frames"
                                         f" {speaking_frames_count}")
                            audio_data_bytes = b''.join(audio_frames)
                            audio_np = np.frombuffer(audio_data_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                            

                            self._ready_for_transcription_queue.put(audio_np)


                            # Reset for next utterance
                            audio_frames.clear()
                            is_speaking = False
                            silent_frames_count = 0
                            speaking_frames_count = 0
                            recent_frames.clear()
                            silence_timeout_frames = silence_timeout_frames_orig
                    else:
                        silent_frames_count = 0
                else:
                    # Last frame wasn't speech, keep buffering recent frames
                    recent_frames.append(frame)
                    
                    if is_speech:
                        # Start of speech detected
                        is_speaking = True
                        silent_frames_count = 0
                        speaking_frames_count = 1
                        
                        # Add buffered padding frames from before speech started
                        audio_frames = list(recent_frames)

            except Exception as e:
                logging.error(f"Error in audio capture loop: {e}")
                time.sleep(0.1)

        stream.stop_stream()
        stream.close()
        p.terminate()

    def get_ready_audio_chunk(self):
        """
        Non-blocking method to get an audio chunk if available.
        Returns None if no audio is ready.
        """
        try:
            audio_np = self._ready_for_transcription_queue.get_nowait()
            return audio_np
        except Empty:
            return None
    
    def transcribe_chunk(self, audio_np):
        """
        Synchronous method to transcribe an audio chunk.
        This is CPU-intensive and should be run in a thread pool.
        """
        logging.info(f"transcribe_chunk called with audio length: {len(audio_np)/self.config.sample_rate:.2f}s")
        try:
            logging.info("Starting model.transcribe...")
            segments, _ = self.model.transcribe(
                audio_np,
                beam_size=self.config.beam_size,
                language=self.config.language,
                word_timestamps=self.config.word_timestamps,
                condition_on_previous_text=self.config.condition_on_previous_text and not self.model_failed_last_transcription,
                initial_prompt="Speaker is working on and explaining VoiceTree software",
                vad_filter=self.config.use_vad_filter,
                vad_parameters=dict(
                    min_silence_duration_ms=self.config.MIN_SILENCE_DURATION_MS)
            )
            logging.info("model.transcribe completed")

            segments_list = list(segments)
            logging.info(f"Number of segments: {len(segments_list)}")
            
            full_text = "".join(segment.text.strip() + " " for segment in segments_list)
            final_text = full_text.strip()

            if final_text:
                print(final_text)
                logging.info(f"Transcription result: {final_text}|END")
            else:
                logging.warning("No text transcribed from audio chunk")
                self.model_failed_last_transcription = True
            
            return final_text

        except Exception as e:
            logging.error(f"Error during transcription: {e}", exc_info=True)

        return ""