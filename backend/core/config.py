"""
Unified Configuration for VoiceTree
Single source of truth for all application settings
"""

import os
from pathlib import Path
from typing import Optional, List
from pydantic import BaseModel, Field
from dotenv import load_dotenv


class LLMConfig(BaseModel):
    """LLM-specific configuration"""
    google_api_key: str = Field(..., description="Google API key for Gemini")
    default_model: str = Field(default="gemini-2.0-flash", description="Default model to use")
    max_output_tokens: int = Field(default=8192, description="Maximum output tokens")
    temperature: float = Field(default=0.1, description="Temperature for generation")
    timeout_seconds: int = Field(default=30, description="Request timeout in seconds")


class BufferConfig(BaseModel):
    """Buffer management configuration"""
    text_buffer_size_threshold: int = Field(default=500, description="Buffer size threshold for processing")
    transcript_history_multiplier: int = Field(default=3, description="History multiplier for context")
    background_rewrite_every_n_append: int = Field(default=2, description="Background rewrite frequency")


class WorkflowConfig(BaseModel):
    """Workflow-specific configuration"""
    enable_background_optimization: bool = Field(default=True, description="Enable TROA background optimization")
    optimization_interval_minutes: int = Field(default=2, description="TROA optimization interval")
    max_workflow_retries: int = Field(default=3, description="Maximum workflow retry attempts")


class VoiceTreeConfig(BaseModel):
    """Main VoiceTree configuration"""
    # Core settings
    debug: bool = Field(default=False, description="Enable debug mode")
    log_level: str = Field(default="INFO", description="Logging level")
    
    # Component configs
    llm: LLMConfig
    buffer: BufferConfig = Field(default_factory=BufferConfig)
    workflow: WorkflowConfig = Field(default_factory=WorkflowConfig)
    
    # File paths
    state_file: Optional[str] = Field(default="voicetree_state.json", description="State persistence file")
    output_dir: str = Field(default="markdownTreeVault", description="Output directory for markdown files")
    
    @classmethod
    def from_env(cls) -> "VoiceTreeConfig":
        """Load configuration from environment variables and .env files"""
        # Load environment variables from multiple potential .env locations
        potential_env_paths = [
            Path.cwd() / '.env',
            Path.cwd().parent / '.env', 
            Path.cwd().parent.parent / '.env',
            Path.home() / 'repos' / 'VoiceTreePoc' / '.env'
        ]
        
        for env_path in potential_env_paths:
            if env_path.exists():
                load_dotenv(env_path)
                break
        
        # Get API key from environment
        google_api_key = os.environ.get("GOOGLE_API_KEY")
        if not google_api_key:
            raise ValueError(
                "GOOGLE_API_KEY environment variable is required. "
                "Please set it in your environment or .env file."
            )
        
        # Create LLM config
        llm_config = LLMConfig(
            google_api_key=google_api_key,
            default_model=os.environ.get("LLM_DEFAULT_MODEL", "gemini-2.0-flash"),
            max_output_tokens=int(os.environ.get("LLM_MAX_OUTPUT_TOKENS", "8192")),
            temperature=float(os.environ.get("LLM_TEMPERATURE", "0.1"))
        )
        
        # Create buffer config from legacy settings
        buffer_config = BufferConfig(
            text_buffer_size_threshold=int(os.environ.get("TEXT_BUFFER_SIZE_THRESHOLD", "500")),
            transcript_history_multiplier=int(os.environ.get("TRANSCRIPT_HISTORY_MULTIPLIER", "3")),
            background_rewrite_every_n_append=int(os.environ.get("BACKGROUND_REWRITE_EVERY_N_APPEND", "2"))
        )
        
        # Create workflow config  
        workflow_config = WorkflowConfig(
            enable_background_optimization=os.environ.get("ENABLE_BACKGROUND_OPTIMIZATION", "true").lower() == "true",
            optimization_interval_minutes=int(os.environ.get("OPTIMIZATION_INTERVAL_MINUTES", "2"))
        )
        
        return cls(
            debug=os.environ.get("DEBUG", "false").lower() == "true",
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            llm=llm_config,
            buffer=buffer_config,
            workflow=workflow_config,
            state_file=os.environ.get("STATE_FILE", "voicetree_state.json"),
            output_dir=os.environ.get("OUTPUT_DIR", "markdownTreeVault")
        )


# Global configuration instance
_config: Optional[VoiceTreeConfig] = None


def get_config() -> VoiceTreeConfig:
    """Get the global configuration instance"""
    global _config
    if _config is None:
        _config = VoiceTreeConfig.from_env()
    return _config


def reset_config() -> None:
    """Reset configuration (mainly for testing)"""
    global _config
    _config = None 