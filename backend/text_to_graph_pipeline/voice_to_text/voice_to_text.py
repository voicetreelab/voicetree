import logging

import speech_recognition as sr
from faster_whisper import WhisperModel
import numpy as np
import asyncio
from datetime import datetime, timedelta, timezone
from queue import Queue

from backend.text_to_graph_pipeline.voice_to_text.voice_config import VoiceConfig


class VoiceToTextEngine:
    def __init__(self, config: VoiceConfig = None):
        self.config = config or VoiceConfig()
        
        self.recorder = sr.Recognizer()
        self.recorder.energy_threshold = self.config.energy_threshold
        self.recorder.dynamic_energy_threshold = self.config.dynamic_energy_threshold
        self.recorder.dynamic_energy_adjustment_damping = self.config.dynamic_energy_adjustment_damping
        self.recorder.dynamic_energy_ratio = self.config.dynamic_energy_ratio
        
        self.audio_model = WhisperModel(self.config.model, device="cpu", compute_type="auto")
        
        self.phrase_time = None
        self.data_queue = Queue()
        self.transcription = ['']
        self.overlap_buffer = b''  # Buffer for overlap between chunks
        self.previous_segments = []  # Store previous segments for overlap correction

    def start_listening(self):
        """Starts continuous listening in the background."""
        source = sr.Microphone(sample_rate=self.config.sample_rate)
        with source:
            self.recorder.adjust_for_ambient_noise(source)
        print("Model loaded.\n")

        self.recorder.listen_in_background(source, self.record_callback, phrase_time_limit=self.config.record_timeout)

        # while True:
        #     try:
        #         await self.process_audio_queue()
        #         await asyncio.sleep(0.1)  # Avoid busy-waiting
        #
        #     except KeyboardInterrupt:
        #         break

    def process_audio_queue(self):
        """Processes audio chunks from the queue."""
        if not self.data_queue.empty():
            phrase_complete = False
            now = datetime.now(timezone.utc)
            if self.phrase_time and now - self.phrase_time > timedelta(seconds=self.config.phrase_timeout):
                phrase_complete = True
            self.phrase_time = now

            # Combine overlap buffer with new audio data
            new_audio_data = b''.join(self.data_queue.queue)
            audio_data = self.overlap_buffer + new_audio_data
            
            # Don't clear the queue yet - save any new audio that arrives during transcription
            current_queue_size = self.data_queue.qsize()
            
            # Calculate overlap size based on configuration
            # Larger overlap ensures words at boundaries are captured in both chunks
            overlap_size = int(self.config.sample_rate * self.config.overlap_seconds * 2)  # samples/sec * overlap_sec * 2 bytes/sample
            if len(audio_data) > overlap_size:
                self.overlap_buffer = audio_data[-overlap_size:]
            else:
                self.overlap_buffer = audio_data
            
            audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
            result, _ = self.audio_model.transcribe(
                audio_np, 
                language="en",
                vad_filter=self.config.vad_filter,
                vad_parameters=self.config.vad_parameters,
                temperature=self.config.temperature,
                condition_on_previous_text=self.config.condition_on_previous_text,
                word_timestamps=self.config.word_timestamps,
                initial_prompt=self.config.initial_prompt,
                best_of=self.config.best_of,
                beam_size=self.config.beam_size
            )
            
            # Now clear only the processed audio from the queue
            for _ in range(current_queue_size):
                if not self.data_queue.empty():
                    self.data_queue.get()
            text = ""

            segments_with_info = []
            for segment in result:
                segments_with_info.append({
                    'text': segment.text.strip(),
                    'start': segment.start,
                    'end': segment.end,
                    'words': segment.words if hasattr(segment, 'words') else None
                })
                print(segment.text)
                text += segment.text.strip()
                logging.info(f"Transcribed segment: {segment.text.strip()}")
            
            # Store segment info for potential overlap correction
            if hasattr(self, 'previous_segments'):
                # TODO: Implement overlap-based correction here
                # Compare word timestamps with previous segments
                # Pick best version based on confidence/context
                pass
            self.previous_segments = segments_with_info
            logging.info("Phrase complete? "+str(phrase_complete))
            # if phrase_complete:
            #todo, thought end detection based on time not speaking...
            return text
        return None

    def record_callback(self, _, audio: sr.AudioData):
        """Callback for audio data from SpeechRecognizer."""
        data = audio.get_raw_data()
        self.data_queue.put(data)
