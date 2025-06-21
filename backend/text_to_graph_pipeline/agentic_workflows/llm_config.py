"""
LLM configuration for agentic workflows
"""

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Any
import google.generativeai as genai


class LLMTask(Enum):
    SUMMARIZE = "summarize"
    REWRITE = "rewrite"
    CLASSIFY = "classify"


class AvailableModels(Enum):
    PRO = "models/gemini-2.5-pro-preview-06-05"
    FLASH = "models/gemini-2.0-flash"


@dataclass
class LLMConfig:
    """Configuration for LLM usage in agentic workflows"""
    
    # Model selection per task
    model_map: Dict[LLMTask, str] = None
    
    # Temperature settings per task
    temperature_map: Dict[LLMTask, float] = None
    
    # Safety settings
    safety_settings: list = None
    
    def __post_init__(self):
        """Set defaults if not provided"""
        if self.model_map is None:
            self.model_map = {
                LLMTask.SUMMARIZE: AvailableModels.PRO.value,
                LLMTask.CLASSIFY: AvailableModels.PRO.value,
                LLMTask.REWRITE: AvailableModels.PRO.value,
            }
        
        if self.temperature_map is None:
            self.temperature_map = {
                LLMTask.SUMMARIZE: 0.3,
                LLMTask.CLASSIFY: 0.2,
                LLMTask.REWRITE: 0.4,
            }
        
        if self.safety_settings is None:
            self.safety_settings = [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
            ]
    
    def get_model(self, task: LLMTask) -> genai.GenerativeModel:
        """Get configured model for a specific task"""
        model_name = self.model_map.get(task, AvailableModels.PRO.value)
        return genai.GenerativeModel(model_name)
    
    def get_parameters(self, task: LLMTask) -> Dict[str, Any]:
        """Get parameters for a specific task"""
        return {
            "temperature": self.temperature_map.get(task, 0.3),
            "safety_settings": self.safety_settings
        }