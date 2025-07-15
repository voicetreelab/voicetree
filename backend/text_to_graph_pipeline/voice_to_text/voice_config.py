"""
Voice to text configuration
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional


@dataclass
class VoiceConfig:
    """Configuration for voice to text processing"""
    
    # Model configuration
    model: str = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"  # Whisper model to use - larger models are more accurate but slower
    
    # Audio capture settings
    sample_rate: int = 16000  # Audio sample rate in Hz - 16kHz is optimal for speech recognition
    channels: int = 1  # Number of audio channels - mono (1) is sufficient for voice
    energy_threshold: int = 1000  # Microphone sensitivity - increase in noisy environments, decrease for quiet speakers
    dynamic_energy_threshold: bool = True  # Auto-adjust to ambient noise - disable for consistent environments
    dynamic_energy_adjustment_damping: float = 0.15  # How quickly energy threshold adapts - lower = more responsive
    dynamic_energy_ratio: float = 1.5  # Multiplier for dynamic threshold - higher = less sensitive to background noise
    
    # Timing settings
    record_timeout: float = 2.5  # Max seconds to record before processing - shorter = more responsive, longer = captures complete thoughts
    phrase_timeout: float = 1.0  # Seconds of silence to mark phrase end - adjust based on speaking pace
    
    # Overlap settings for accuracy
    overlap_seconds: float = 1.5  # Audio overlap between chunks - increase to reduce missed words at boundaries
    
    # Microphone settings
    default_microphone: str = 'pulse'  # Default microphone identifier - change based on your system
    
    # Transcription parameters
    temperature: List[float] = field(default_factory=lambda: [0.0, 0.2])  # Temperature for sampling - multiple values for fallback on failure
    beam_size: int = 5  # Beam search width - higher = more accurate but slower
    best_of: int = 5  # Number of candidates - higher = better quality at cost of speed
    condition_on_previous_text: bool = False  # Use previous chunk as context - True for narrative, False for independent chunks
    word_timestamps: bool = True  # Extract per-word timing - needed for overlap deduplication
    initial_prompt: Optional[str] = None  # Prompt to guide transcription - use for domain-specific vocabulary
    
    # VAD (Voice Activity Detection) settings
    vad_filter: bool = True  # Enable voice activity detection - reduces hallucinations in silence
    vad_threshold: float = 0.3  # VAD sensitivity (0-1) - lower = more sensitive to soft speech
    vad_min_speech_duration_ms: int = 100  # Minimum speech length - lower to catch brief words
    vad_max_speech_duration_s: float = float('inf')  # Maximum speech segment - usually unlimited
    vad_min_silence_duration_ms: int = 3000  # Silence before splitting - longer = fewer interruptions
    vad_speech_pad_ms: int = 800  # Padding around detected speech - captures word beginnings/endings
    
    @property
    def vad_parameters(self) -> Dict[str, Any]:
        """Returns VAD parameters as a dictionary for faster-whisper"""
        return {
            'threshold': self.vad_threshold,
            'min_speech_duration_ms': self.vad_min_speech_duration_ms,
            'max_speech_duration_s': self.vad_max_speech_duration_s,
            'min_silence_duration_ms': self.vad_min_silence_duration_ms,
            'speech_pad_ms': self.vad_speech_pad_ms
        }
    
    def __post_init__(self):
        """Validate configuration"""
        valid_models = ["distil-large-v3", "large-v3", "mobiuslabsgmbh/faster-whisper-large-v3-turbo"]
        if self.model not in valid_models:
            raise ValueError(f"model must be one of {valid_models}")