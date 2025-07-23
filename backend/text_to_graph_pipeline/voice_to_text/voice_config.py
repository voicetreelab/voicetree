
# backend/text_to_graph_pipeline/voice_to_text/voice_config.py

from dataclasses import dataclass

@dataclass
class VoiceConfig:
    """
    Configuration settings for the VoiceToTextEngine.
    """
    # --- VAD (Voice Activity Detection) Settings ---
    # How aggressive the VAD is.
    """
    It answers the question: "What do I actually count as silence?"

    0 (Least Aggressive): The engineer is extremely sensitive. Even the quietest mouth noise, a faint breath, or distant background hum is considered "speech."

    3 (Most Aggressive): The engineer is very strict. Unless it's a clear, loud, spoken word, they consider it "silence." Background noise, soft breaths, and quiet hums are all ignored and treated as silence.
    """
    vad_aggressiveness: int = 2
    # Duration of a single audio frame for VAD analysis, in milliseconds.
    vad_frame_ms: int = 30
    # Amount of silence to pad at the start and end of a speech segment, in milliseconds.
    # This helps ensure words at the edges aren't cut off.
    vad_padding_ms: int = 150

    #IMPORTANT: How long the VAD should wait in silence before considering an utterance finished, in milliseconds.
    vad_silence_timeout_ms: int = 300 # Increased for more natural pauses
    #     High Value (e.g., 1500 ms): Good for speakers who pause for a second or two in the middle of a sentence to think. It prevents the system from chopping up their thoughts. This is what you're currently experiencing.
    #
    #     Low Value (e.g., 700 ms): Makes the system feel much more responsive and is better for faster, conversational-style speech. It will "flush the buffer" after a much shorter pause.


    # --- Audio Stream Settings ---
    # Audio channels (1 for mono, 2 for stereo). Whisper works with mono.
    audio_channels: int = 1
    # Sample rate in Hz. Whisper models are trained on 16000Hz audio.
    sample_rate: int = 16000

    # --- Whisper Model Settings ---
    # The size of the Whisper model to use (e.g., "tiny", "base", "small", "medium", "large-v3", "distil-large-v3").
    # "large-v3" is the most accurate but also the most resource-intensive.
    model_size: str = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
    # The computation type for the model. "int8" is recommended for CPU execution for a good balance
    # of speed and accuracy. Use "float16" for GPU.
    compute_type: str = "int8"
    # The device to run the model on ("cpu" or "cuda").
    device: str = "cpu"
    # The beam size for decoding. A larger beam size increases accuracy at the cost of speed.
    # A value of 5 is a good trade-off.
    # LOWER IS FASTER, BUT LESS ACCURATE
    beam_size: int = 4
    # The language of the speech. Set to None to let Whisper auto-detect.
    language: str = "en"

    # --- Transcription Behavior Settings ---
    # Whether to use Whisper's internal VAD as a second-pass filter. Recommended.
    use_vad_filter: bool = True
    # Whether to feed the previous transcription as a prompt to the next. Greatly improves
    # contextual accuracy and consistency.
    condition_on_previous_text: bool = True
    # Whether to generate word-level timestamps. Useful for downstream processing.
    word_timestamps: bool = False
    # The number of previous transcriptions to keep for context.
    # todo, experiment with this and how it impacts latency
    history_max_size: int = 3

    