import logging
import time
import traceback

import settings
from tree_manager.LLM_engine.LLM_API import  generate_async
from tree_manager.LLM_engine.prompts.summarize_prompt import create_summarization_prompt


class Summarizer:
    async def summarize_with_llm(self, text: str, transcript_history: str) -> str:
        """
        Summarizes the given text using an LLM.

        Args:
            text (str): The text to summarize.
            transcript_history (str): The transcript history for context.

        Returns:
            str: The summarized text.
        """
        prompt: str = create_summarization_prompt(text, transcript_history)
        try:
            response = await generate_async(settings.LLMTask.SUMMARIZE, prompt)

            return response.strip()
        except Exception as e:
            logging.error(f"Error in summarize_with_llm: {e} "
                          f"- Type: {type(e)} - Traceback: {traceback.format_exc()}")
            return "Error summarizing text."
