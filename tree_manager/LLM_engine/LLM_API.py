import logging
import time
from enum import Enum

import google.generativeai as genai

import settings


async def generate_async(task: settings.LLMTask, prompt):
    # todo: try catch here with exponential backoff

    start_time = time.time()
    model = settings.LLM_MODELS[task]
    response = await model.generate_content_async(
        prompt,
        generation_config=settings.LLM_PARAMETERS[task],
        safety_settings = settings.safety_settings,

    )
    elapsed_time = time.time() - start_time
    logging.info(f"{task.value} Prompt: {prompt}")
    logging.info(f"{task.value}LLM raw response: {response.text}")
    logging.info(f"{task.value}LLM summarization took: {elapsed_time:.4f} seconds")

    return response.text
