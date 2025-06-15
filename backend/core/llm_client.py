"""
Unified LLM Client for VoiceTree
Consolidates all LLM interactions into a single, well-tested interface
"""

import asyncio
import time
import logging
from typing import Type, TypeVar, Dict, Any, Optional, Union
from pydantic import BaseModel

from .config import LLMConfig
from .models import (
    SegmentationResponse, RelationshipResponse, 
    IntegrationResponse, NodeExtractionResponse,
    WorkflowResult
)

# Type variable for generic response types
T = TypeVar('T', bound=BaseModel)

# Schema mapping for different workflow stages
SCHEMA_MAP = {
    "segmentation": SegmentationResponse,
    "relationship": RelationshipResponse,
    "integration": IntegrationResponse,
    "extraction": NodeExtractionResponse
}


class LLMClient:
    """
    Unified LLM client that handles all interactions with language models
    Replaces both legacy LLM_API and modern llm_integration
    """
    
    def __init__(self, config: LLMConfig):
        """
        Initialize the LLM client
        
        Args:
            config: LLM configuration containing API keys and settings
        """
        self.config = config
        self._client = None
        self._initialize_client()
        
        # Statistics tracking
        self.total_calls = 0
        self.total_tokens = 0
        self.total_time_ms = 0.0
        
    def _initialize_client(self) -> None:
        """Initialize the Google GenAI client"""
        try:
            import google.genai as genai
            self._client = genai.Client(api_key=self.config.google_api_key)
            logging.info("✅ Google GenAI client initialized successfully")
        except ImportError:
            raise ImportError(
                "google-genai package not available. Install with: pip install google-genai"
            )
        except Exception as e:
            raise RuntimeError(f"Failed to initialize Google GenAI client: {e}")
    
    async def call_structured(
        self, 
        prompt: str, 
        response_model: Type[T],
        model_name: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> T:
        """
        Make a structured LLM call with Pydantic validation
        
        Args:
            prompt: The prompt to send to the LLM
            response_model: Pydantic model class for structured response
            model_name: Model to use (defaults to config default)
            temperature: Temperature override
            max_tokens: Max tokens override
            
        Returns:
            Validated Pydantic model instance
            
        Raises:
            RuntimeError: If LLM call fails
            ValueError: If response validation fails
        """
        start_time = time.time()
        
        # Use provided parameters or fall back to config defaults
        model = model_name or self.config.default_model
        temp = temperature if temperature is not None else self.config.temperature
        max_out = max_tokens or self.config.max_output_tokens
        
        try:
            logging.info(f"🤖 Calling {model} with structured output...")
            
            response = self._client.models.generate_content(
                model=model,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "response_schema": response_model,
                    "max_output_tokens": max_out,
                    "temperature": temp,
                }
            )
            
            # Update statistics
            elapsed_ms = (time.time() - start_time) * 1000
            self.total_calls += 1
            self.total_time_ms += elapsed_ms
            
            # Try to use parsed response first (from new API)
            if hasattr(response, 'parsed') and response.parsed is not None:
                logging.info(f"✅ Structured response parsed automatically ({elapsed_ms:.1f}ms)")
                return response.parsed
            elif hasattr(response, 'text') and response.text:
                logging.info(f"✅ Raw response received, parsing manually ({elapsed_ms:.1f}ms)")
                
                # Try to extract and clean JSON
                response_text = response.text
                try:
                    response_text = self._extract_json_from_response(response_text)
                except Exception as e:
                    logging.warning(f"JSON extraction failed: {e}")
                
                # Parse and validate
                parsed_response = response_model.model_validate_json(response_text)
                return parsed_response
            else:
                raise ValueError("No text content in LLM response")
                
        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            self.total_calls += 1  # Count failed calls too
            self.total_time_ms += elapsed_ms
            
            error_msg = f"LLM structured call failed: {str(e)}"
            logging.error(error_msg)
            raise RuntimeError(error_msg)
    
    async def call_text(
        self, 
        prompt: str,
        model_name: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> str:
        """
        Make a text-only LLM call
        
        Args:
            prompt: The prompt to send to the LLM
            model_name: Model to use (defaults to config default)
            temperature: Temperature override
            max_tokens: Max tokens override
            
        Returns:
            Raw text response from the LLM
            
        Raises:
            RuntimeError: If LLM call fails
        """
        start_time = time.time()
        
        # Use provided parameters or fall back to config defaults
        model = model_name or self.config.default_model
        temp = temperature if temperature is not None else self.config.temperature
        max_out = max_tokens or self.config.max_output_tokens
        
        try:
            logging.info(f"🤖 Calling {model} for text response...")
            
            response = self._client.models.generate_content(
                model=model,
                contents=prompt,
                config={
                    "max_output_tokens": max_out,
                    "temperature": temp,
                }
            )
            
            # Update statistics
            elapsed_ms = (time.time() - start_time) * 1000
            self.total_calls += 1
            self.total_time_ms += elapsed_ms
            
            if hasattr(response, 'text') and response.text:
                logging.info(f"✅ Text response received ({elapsed_ms:.1f}ms, {len(response.text)} chars)")
                return response.text
            else:
                raise ValueError("No text content in LLM response")
                
        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            self.total_calls += 1  # Count failed calls too
            self.total_time_ms += elapsed_ms
            
            error_msg = f"LLM text call failed: {str(e)}"
            logging.error(error_msg)
            raise RuntimeError(error_msg)
    
    async def call_workflow_stage(
        self,
        prompt: str,
        stage_type: str,
        model_name: Optional[str] = None
    ) -> BaseModel:
        """
        Call LLM for a specific workflow stage with appropriate schema
        
        Args:
            prompt: The prompt to send to the LLM
            stage_type: Workflow stage type (segmentation, relationship, integration, extraction)
            model_name: Model to use (defaults to config default)
            
        Returns:
            Validated response model for the stage
            
        Raises:
            ValueError: If stage type is unknown
            RuntimeError: If LLM call fails
        """
        response_model = SCHEMA_MAP.get(stage_type)
        if not response_model:
            raise ValueError(f"Unknown workflow stage type: {stage_type}")
        
        return await self.call_structured(prompt, response_model, model_name)
    
    def _extract_json_from_response(self, response_text: str) -> str:
        """
        Extract JSON from response text, handling markdown code blocks
        
        Args:
            response_text: Raw response text that might contain JSON
            
        Returns:
            Cleaned JSON string
        """
        import re
        
        # Remove markdown code blocks if present
        json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response_text, re.DOTALL)
        if json_match:
            return json_match.group(1)
        
        # Try to find JSON object in the text
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            return json_match.group(0)
        
        # Return as-is if no patterns found
        return response_text.strip()
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get client usage statistics"""
        avg_time = self.total_time_ms / self.total_calls if self.total_calls > 0 else 0.0
        
        return {
            "total_calls": self.total_calls,
            "total_tokens": self.total_tokens,
            "total_time_ms": self.total_time_ms,
            "average_time_ms": avg_time,
            "current_model": self.config.default_model
        }
    
    def reset_statistics(self) -> None:
        """Reset usage statistics"""
        self.total_calls = 0
        self.total_tokens = 0
        self.total_time_ms = 0.0


# Legacy compatibility functions
async def call_llm_structured(prompt: str, stage_type: str, model_name: str = None) -> BaseModel:
    """
    Legacy compatibility function for structured LLM calls
    
    DEPRECATED: Use LLMClient.call_workflow_stage() instead
    """
    logging.warning("call_llm_structured is deprecated. Use LLMClient.call_workflow_stage() instead.")
    
    # Import here to avoid circular imports
    from .config import get_config
    
    config = get_config()
    client = LLMClient(config.llm)
    return await client.call_workflow_stage(prompt, stage_type, model_name)


async def call_llm(prompt: str, model_name: str = None) -> str:
    """
    Legacy compatibility function for text LLM calls
    
    DEPRECATED: Use LLMClient.call_text() instead
    """
    logging.warning("call_llm is deprecated. Use LLMClient.call_text() instead.")
    
    # Import here to avoid circular imports
    from .config import get_config
    
    config = get_config()
    client = LLMClient(config.llm)
    return await client.call_text(prompt, model_name) 