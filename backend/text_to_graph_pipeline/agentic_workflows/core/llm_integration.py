"""
Centralized LLM integration module for Google Gemini API.

Supports both Google AI Studio (API key) and Vertex AI (ADC authentication).

Authentication Modes:
    Mode 1: Google AI Studio (API key)
        Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable

    Mode 2: Vertex AI with ADC
        Set GOOGLE_GENAI_USE_VERTEXAI=true
        Set GOOGLE_CLOUD_PROJECT=your-project-id
        Optionally set GOOGLE_CLOUD_LOCATION (defaults to us-central1)
        ADC handles authentication via gcloud auth application-default login

Priority: If GOOGLE_GENAI_USE_VERTEXAI=true, use Vertex AI. Otherwise, use API key mode.
"""

import logging
import os
from typing import Any

from google import genai
from google.genai.types import EmbedContentConfig
from google.genai.types import GenerateContentConfig


# Configuration constants
CONFIG = {
    "default_model": "gemini-2.5-flash",
    "default_embedding_model": "gemini-embedding-001",
    "default_location": "us-central1",
}

# Module-level client singleton
_client: genai.Client | None = None

logger = logging.getLogger(__name__)


def get_client() -> genai.Client:
    """
    Get or create the Gemini client singleton.

    Supports both Google AI Studio (API key) and Vertex AI (ADC) authentication.

    Environment Variables:
        GOOGLE_GENAI_USE_VERTEXAI: Set to "true" to use Vertex AI mode
        GOOGLE_CLOUD_PROJECT: Required when using Vertex AI
        GOOGLE_CLOUD_LOCATION: Optional, defaults to "us-central1"
        GOOGLE_API_KEY or GEMINI_API_KEY: Required when using API key mode

    Returns:
        genai.Client: Configured Gemini client

    Raises:
        ValueError: If required environment variables are not set
    """
    global _client

    if _client is not None:
        return _client

    use_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"

    if use_vertex:
        # Vertex AI mode - uses ADC automatically
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        location = os.getenv("GOOGLE_CLOUD_LOCATION", CONFIG["default_location"])
        if not project:
            raise ValueError(
                "GOOGLE_CLOUD_PROJECT required when GOOGLE_GENAI_USE_VERTEXAI=true"
            )
        _client = genai.Client(vertexai=True, project=project, location=location)
        logger.info(f"Initialized Gemini client with Vertex AI (project={project}, location={location})")
    else:
        # Google AI Studio mode - uses API key
        api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY required")
        _client = genai.Client(api_key=api_key)
        logger.info("Initialized Gemini client with API key")

    return _client


def reset_client() -> None:
    """
    Reset the client singleton. Useful for testing or when environment changes.
    """
    global _client
    _client = None


def generate_content(
    prompt: str,
    model: str | None = None,
    temperature: float | None = None,
    **kwargs: Any,
) -> str:
    """
    Generate text content using Gemini.

    Args:
        prompt: The prompt to send to the model
        model: Model name (defaults to CONFIG["default_model"])
        temperature: Sampling temperature
        **kwargs: Additional arguments passed to generate_content

    Returns:
        Generated text content

    Raises:
        ValueError: If generation fails or returns empty response
    """
    client = get_client()
    model_name = model or CONFIG["default_model"]

    config_dict: dict[str, Any] = {}
    if temperature is not None:
        config_dict["temperature"] = temperature

    config = GenerateContentConfig(**config_dict) if config_dict else None

    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=config,
        **kwargs,
    )

    if not response.text:
        raise ValueError("Empty response from Gemini API")

    return response.text


def embed_content(
    content: str | list[str],
    model: str | None = None,
    task_type: str = "retrieval_document",
    title: str | None = None,
) -> list[float] | list[list[float]]:
    """
    Generate embeddings for content using Gemini.

    Args:
        content: Text or list of texts to embed
        model: Embedding model name (defaults to CONFIG["default_embedding_model"])
        task_type: Type of embedding task. Options:
            - "retrieval_document": For documents to be searched
            - "retrieval_query": For search queries
            - "semantic_similarity": For comparing text similarity
            - "classification": For text classification
            - "clustering": For clustering texts
        title: Optional title for the content (used with retrieval_document)

    Returns:
        Embedding vector(s) as list of floats. Returns a single list for single input,
        or list of lists for batch input.
    """
    client = get_client()
    model_name = model or CONFIG["default_embedding_model"]

    config_dict: dict[str, Any] = {"task_type": task_type}
    if title is not None:
        config_dict["title"] = title

    config = EmbedContentConfig(**config_dict)

    response = client.models.embed_content(
        model=model_name,
        contents=content,
        config=config,
    )

    # Handle both single and batch embeddings
    if isinstance(content, str):
        # Single content - return single embedding
        return list(response.embeddings[0].values)
    else:
        # Batch content - return list of embeddings
        return [list(emb.values) for emb in response.embeddings]
