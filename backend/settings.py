import os
from enum import Enum
import google.generativeai as genai

from google.generativeai.types import HarmCategory, HarmBlockThreshold

GOOGLE_API_KEY=os.getenv("GOOGLE_API_KEY")


class LLMTask(Enum):
    SUMMARIZE = "summarize"
    REWRITE = "rewrite"
    CLASSIFY = "classify"


class AvailableModels(Enum):
    PRO = genai.GenerativeModel("models/gemini-2.5-pro-preview-06-05")
    FLASH = genai.GenerativeModel("models/gemini-2.0-flash")


LLM_PARAMETERS = {
    LLMTask.SUMMARIZE: {"temperature": 0.3},
    LLMTask.CLASSIFY: {"temperature": 0.2},
    LLMTask.REWRITE: {"temperature": 0.4}
}

VOICE_MODEL = "large-v3"  # opt: distil-large-v3, large-v3

LLM_MODELS = {
    LLMTask.SUMMARIZE: AvailableModels.PRO.value,
    LLMTask.CLASSIFY: AvailableModels.PRO.value,
    LLMTask.REWRITE: AvailableModels.PRO.value,
}

safety_settings = [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                   {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                   {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                   {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}]

NUM_RECENT_NODES_INCLUDE = 10
TEXT_BUFFER_SIZE_THRESHOLD = 83 # Increase buffer -> greater accuracy / worse speed tradeoff
BACKGROUND_REWRITE_EVERY_N_APPEND = 2
TRANSCRIPT_HISTORY_MULTIPLIER: int = 3  # todo: lower or higher?
# lower, function of just to provide enough context to immediate text...
# higher, llm uses it more as an overview of the whole context to meeting
