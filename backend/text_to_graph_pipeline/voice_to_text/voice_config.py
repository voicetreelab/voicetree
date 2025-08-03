# backend/text_to_graph_pipeline/voice_to_text/voice_config.py

from dataclasses import dataclass

@dataclass
class VoiceConfig:
    """
    Configuration settings for the VoiceToTextEngine.
    This version is designed for the speech_recognition library VAD.
    """
    # =========================================================================
    # --- SpeechRecognition VAD (Voice Activity Detection) Settings ---
    # These settings replace the old manual webrtcvad parameters.
    # =========================================================================

    # --- Key VAD Timings ---

    # Corresponds to the old `vad_silence_timeout_ms`.
    # This is the most important setting: the number of seconds of silence after
    # speaking before we consider the phrase to be complete.
    # Your old setting was 900ms, so we set this to 0.9 seconds.
    # A lower value (e.g., 0.5) feels more responsive.
    # A higher value (e.g., 1.5) is better for speakers who pause to think.
    pause_threshold: float = 0.9

    # Corresponds to the old `vad_total_timeout_ms`.
    # The maximum number of seconds a phrase can be. This prevents the listener
    # from recording indefinitely if the `pause_threshold` is never met.
    # Your old setting was 7000ms, so we set this to 7 seconds.
    # Set to `None` for no limit.
    phrase_time_limit: int = 45

    # --- Dynamic Energy Threshold Settings ---
    # These settings replace the old `vad_aggressiveness`.
    # They automatically adapt to background noise.

    # If True, the energy threshold will be automatically adjusted for
    # ambient noise levels. This is highly recommended.
    dynamic_energy_threshold: bool = True

    # A manual energy threshold for considering when a sound is speech.
    # This is only used if `dynamic_energy_threshold` is False.
    # Higher values mean less sensitivity (it needs to be louder).
    energy_threshold: int = 1000

    # If using dynamic energy, this is the multiplier for how much louder
    # speech must be than the ambient noise. The default is 1.5.
    # Higher values make the VAD less sensitive (like a higher aggressiveness).
    dynamic_energy_ratio: float = 1.3


    # =========================================================================
    # --- Whisper Model & Transcription Settings ---
    # These settings are passed directly to faster-whisper and are unchanged.
    # =========================================================================

    # The size of the Whisper model to use. You were using "distil-medium.en".
    model_size: str = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"

    # The computation type for the model. "int8" is good for CPU.
    compute_type: str = "int8"

    # The device to run the model on ("cpu" or "cuda").
    device: str = "cpu"

    # Number of CPU threads for transcription.
    cpu_threads: int = 8

    # Beam size for decoding. Lower is faster but can be less accurate.
    beam_size: int = 3

    # Language of the speech.
    language: str = "en"

    # Whether to use Whisper's internal VAD as a second-pass filter. Recommended.
    use_vad_filter: bool = True

    # Minimum silence duration in ms for Whisper's VAD filter.
    MIN_SILENCE_DURATION_MS: int = 500

    # Feeds the previous transcription as a prompt to the next for better context.
    condition_on_previous_text: bool = True

    # Whether to generate word-level timestamps.
    word_timestamps: bool = False

    # =========================================================================
    # --- PyAudio Source Settings ---
    # These settings are still needed to configure the microphone source.
    # =========================================================================

    # Audio channels (1 for mono, 2 for stereo). Whisper requires mono.
    audio_channels: int = 1

    # Sample rate in Hz. Whisper models are trained on 16000Hz audio.
    sample_rate: int = 16000