import logging

import speech_recognition as sr
from faster_whisper import WhisperModel
import numpy as np
import asyncio
from datetime import datetime, timedelta
from queue import Queue

from backend import settings


class VoiceToTextEngine:
    def __init__(self, whisper_model_name=settings.VOICE_MODEL,
                 energy_threshold=1000, record_timeout=2, phrase_timeout=1,
                 default_microphone='pulse'):
        self.recorder = sr.Recognizer()
        self.recorder.energy_threshold = energy_threshold
        self.recorder.dynamic_energy_threshold = False
        self.audio_model = WhisperModel(whisper_model_name, device="cpu", compute_type="int8")
        self.record_timeout = record_timeout
        self.phrase_timeout = phrase_timeout
        self.default_microphone = default_microphone

        self.phrase_time = None
        self.data_queue = Queue()
        self.transcription = ['']

    def start_listening(self):
        """Starts continuous listening in the background."""
        source = sr.Microphone(sample_rate=16000)
        with source:
            self.recorder.adjust_for_ambient_noise(source)
        print("Model loaded.\n")

        self.recorder.listen_in_background(source, self.record_callback, phrase_time_limit=self.record_timeout)

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
