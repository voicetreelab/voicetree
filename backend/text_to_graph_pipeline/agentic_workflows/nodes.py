"""
Node functions for VoiceTree LangGraph workflow
Each node represents a stage in the processing pipeline
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
import logging

from .prompt_engine import PromptLoader

# Set up logging
# Get a logger instance
logger = logging.getLogger(__name__)

# Define a specific log file for workflow I/O
LOG_FILE = Path(__file__).parent / "workflow_io.log"

def log_to_file(stage_name: str, log_type: str, content: str):
    """Append logs to a dedicated file for detailed I/O review"""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"--- START: {stage_name} - {log_type} ---\n")
            f.write(content)
            f.write(f"\n--- END: {stage_name} - {log_type} ---\n\n")
    except Exception as e:
        logger.error(f"Failed to write to workflow_io.log: {e}")


# Import the LLM integration and debug logger
try:
    from backend.text_to_graph_pipeline.agentic_workflows.llm_integration import call_llm_structured, call_llm
    from backend.text_to_graph_pipeline.agentic_workflows.debug_logger import log_stage_input_output, log_transcript_processing
except ImportError:  # pragma: no cover
    # If running from a different directory, try relative import
    try:
        from llm_integration import call_llm_structured, call_llm
        from debug_logger import log_stage_input_output, log_transcript_processing
    except ImportError:
        print("⚠️ Could not import LLM integration - using mock implementation")
        
        # Mock debug logging
        def log_stage_input_output(stage_name: str, inputs: dict, outputs: dict):
            print(f"📝 (Mock) Would log {stage_name} I/O")
        
        def log_transcript_processing(transcript_text: str, file_source: str = "unknown"):
            print(f"📝 (Mock) Would log transcript input")
        
        # Fallback mock implementation
        def call_llm_structured(prompt: str, stage_type: str) -> dict:
            """Mock structured LLM call for testing"""
            print(f"=== MOCK STRUCTURED LLM CALL (FALLBACK) ===")
            print(f"Stage: {stage_type}")
            print(f"Prompt length: {len(prompt)} characters")
            print("===================")
            return {"mock": "response"}
        
        def call_llm(prompt: str) -> str:
            """Mock LLM call for testing"""
            print(f"=== MOCK LLM CALL (FALLBACK) ===")
            print(f"Prompt length: {len(prompt)} characters")
            print("===================")
            return "Mock response"


# Constants
PROMPT_DIR = Path(__file__).parent / "prompts"
MAX_NODE_NAME_LENGTH = 100
EXCLUDED_PHRASES = ["based on", "provided data", "new nodes"]

# Initialize prompt loader
prompt_loader = PromptLoader(PROMPT_DIR)


def extract_json_from_response(response: str) -> str:
    """
    Extract JSON from LLM response, handling common formatting issues
    
    Args:
        response: Raw LLM response text
        
    Returns:
        Cleaned JSON string
    """
    import json
    
    # Remove whitespace
    response = response.strip()
    
    if not response:
        return response
    
    # Try to find JSON in markdown code blocks
    json_pattern = r'```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```'
    match = re.search(json_pattern, response, re.DOTALL)
    if match:
        json_text = match.group(1)
        try:
            # Validate the extracted JSON
            json.loads(json_text)
            return json_text
        except json.JSONDecodeError:
            pass
    
    # Try to find JSON object or array directly
    # Look for outermost braces/brackets
    json_pattern = r'(\{.*\}|\[.*\])'
    match = re.search(json_pattern, response, re.DOTALL)
    if match:
        json_text = match.group(1)
        try:
            # Validate the extracted JSON
            json.loads(json_text)
            return json_text
        except json.JSONDecodeError:
            # Try to fix common issues
            fixed_json = _fix_json_response(json_text)
            try:
                json.loads(fixed_json)
                return fixed_json
            except json.JSONDecodeError:
                pass
    
    # If no JSON found or validation failed, return original
    return response


def _fix_json_response(json_text: str) -> str:
    """
    Fix common JSON formatting issues
    
    Args:
        json_text: Potentially malformed JSON
        
    Returns:
        Fixed JSON string
    """
    import json
    
    # Remove any leading/trailing whitespace
    json_text = json_text.strip()
    
    # Fix incomplete JSON by adding missing closing braces/brackets
    if json_text and (json_text.startswith('{') or json_text.startswith('[')):
        open_braces = json_text.count('{') - json_text.count('}')
        open_brackets = json_text.count('[') - json_text.count(']')
        
        # Add missing closing braces/brackets
        json_text += '}' * max(0, open_braces)
        json_text += ']' * max(0, open_brackets)
    
    # Fix trailing commas
    json_text = re.sub(r',(\s*[}\]])', r'\1', json_text)
    
    # Fix quotes around property names
    json_text = re.sub(r'(\w+):', r'"\1":', json_text)
    
    return json_text


def process_llm_stage_structured(
    state: Dict[str, Any],
    stage_name: str,
    stage_type: str,
    prompt_name: str,
    prompt_kwargs: Dict[str, Any],
    result_key: str,
    next_stage: str
) -> Dict[str, Any]:
    """
    Generic function to process an LLM stage with structured output
    
    Args:
        state: Current pipeline state
        stage_name: Display name for the stage
        stage_type: Stage type for schema mapping (segmentation, relationship, integration, extraction)
        prompt_name: Name of the prompt template to use
        prompt_kwargs: Arguments to format the prompt template
        result_key: Key to store the result in state
        next_stage: Name of the next stage
        
    Returns:
        Updated state dictionary
    """
    print(f"🔵 Stage: {stage_name}")
    
    # Log the input variables for debugging
    debug_inputs = {
        "stage_name": stage_name,
        "stage_type": stage_type,
        "prompt_name": prompt_name,
        **prompt_kwargs,
        "relevant_state_keys": [k for k in state.keys() if k not in ["current_stage", "error_message"]]
    }
    
    try:
        # Load and format prompt using PromptLoader
        prompt = prompt_loader.render_template(prompt_name, **prompt_kwargs)
        
        # Log input prompt
        log_to_file(stage_name, "INPUT_PROMPT", prompt)
        
        # Call LLM with structured output
        response = call_llm_structured(prompt, stage_type)
        
        # Log structured response
        log_to_file(stage_name, "STRUCTURED_RESPONSE", response.model_dump_json(indent=2))
        
        # Extract the relevant data from the response
        if hasattr(response, result_key):
            result = getattr(response, result_key)
        else:
            # Handle cases where the response is the data itself
            if result_key == "chunks" and hasattr(response, 'chunks'):
                result = response.chunks
            elif result_key == "analyzed_chunks" and hasattr(response, 'analyzed_chunks'):
                result = response.analyzed_chunks
            elif result_key == "integration_decisions" and hasattr(response, 'integration_decisions'):
                result = response.integration_decisions
            elif result_key == "new_nodes" and hasattr(response, 'new_nodes'):
                result = response.new_nodes
            else:
                # Fallback to converting to dict
                result_dict = response.model_dump()
                result = result_dict.get(result_key, [])
        
        # Convert Pydantic models to dicts for compatibility with existing code
        if hasattr(result, '__iter__') and not isinstance(result, str):
            result = [item.model_dump() if hasattr(item, 'model_dump') else item for item in result]
        elif hasattr(result, 'model_dump'):
            result = result.model_dump()
        
        # Log the final result
        log_to_file(stage_name, "FINAL_RESULT", str(result)[:500] + "..." if len(str(result)) > 500 else str(result))
        
        # Prepare the final state
        final_state = {
            **state,
            result_key: result,
            "current_stage": next_stage
        }
        
        # Log debug information
        debug_outputs = {
            result_key: result,
            "current_stage": next_stage,
            "result_count": len(result) if isinstance(result, list) else 1,
            "result_type": type(result).__name__
        }
        
        log_stage_input_output(stage_name.lower().replace(" ", "_"), debug_inputs, debug_outputs)
        
        return final_state
        
    except Exception as e:
        error_msg = f"{stage_name} failed: {str(e)}"
        print(f"❌ {error_msg}")
        
        # For debugging, log the full error details
        log_to_file(stage_name, "ERROR", f"Exception: {str(e)}\nState: {state}")
        
        # Log debug information for errors too
        debug_outputs = {
            "error_message": error_msg,
            "current_stage": "error",
            "exception_type": type(e).__name__
        }
        
        log_stage_input_output(stage_name.lower().replace(" ", "_"), debug_inputs, debug_outputs)
        
        return {
            **state,
            "current_stage": "error",
            "error_message": error_msg
        }


def segmentation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Stage 1: Segment transcript into atomic idea chunks"""
    
    # Log the transcript being processed
    transcript_text = state.get("transcript_text", "")
    if transcript_text:
        log_transcript_processing(transcript_text, "segmentation_node")
    
    # Use structured output for segmentation
    result = process_llm_stage_structured(
        state=state,
        stage_name="Segmentation",
        stage_type="segmentation",
        prompt_name="segmentation",
        prompt_kwargs={"transcript_text": state["transcript_text"]},
        result_key="chunks",
        next_stage="segmentation_complete"
    )
    
    # If segmentation failed or returned no chunks, create a simple fallback
    if result.get("current_stage") == "error" or not result.get("chunks"):
        print("⚠️ Segmentation failed or returned no chunks, creating fallback segmentation")
        transcript = state["transcript_text"].strip()
        if transcript:
            # Create a simple single chunk as fallback
            fallback_chunk = {
                "name": "Voice Input",
                "text": transcript,
                "is_complete": True
            }
            result = {
                **state,
                "chunks": [fallback_chunk],
                "current_stage": "segmentation_complete",
                "incomplete_chunk_remainder": None
            }
            print(f"   ✅ Created fallback segmentation with 1 chunk")
        else:
            # Empty transcript, return error
            return {
                **state,
                "current_stage": "error",
                "error_message": "Empty transcript provided for segmentation"
            }
    
    # If segmentation was successful, filter out incomplete chunks
    if result.get("chunks") and result["current_stage"] != "error":
        complete_chunks = []
        incomplete_chunk = None
        
        for chunk in result["chunks"]:
            if chunk.get("is_complete", True):  # Default to True if not specified
                complete_chunks.append(chunk)
            else:
                # Save the last incomplete chunk to carry forward
                incomplete_chunk = chunk
                print(f"   ⏳ Found incomplete chunk: '{chunk.get('name', 'Unnamed')[:50]}...'")
        
        # Update result with filtered chunks
        result["chunks"] = complete_chunks
        
        # Save incomplete chunk text for next execution
        if incomplete_chunk:
            result["incomplete_chunk_remainder"] = incomplete_chunk.get("text", "")
        else:
            result["incomplete_chunk_remainder"] = None
        
        print(f"   ✅ Processing {len(complete_chunks)} complete chunks")
        if incomplete_chunk:
            print(f"   ⏳ 1 incomplete chunk saved for next execution")
    
    return result


def relationship_analysis_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Stage 2: Analyze relationships between chunks and existing nodes"""
    return process_llm_stage_structured(
        state=state,
        stage_name="Relationship Analysis",
        stage_type="relationship",
        prompt_name="relationship_analysis",
        prompt_kwargs={
            "existing_nodes": state["existing_nodes"],
            "sub_chunks": json.dumps(state["chunks"], indent=2)
        },
        result_key="analyzed_chunks",
        next_stage="relationship_analysis_complete"
    )


def integration_decision_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Stage 3: Decide whether to APPEND or CREATE for each chunk"""
    return process_llm_stage_structured(
        state=state,
        stage_name="Integration Decision",
        stage_type="integration",
        prompt_name="integration_decision",
        prompt_kwargs={
            "analyzed_sub_chunks": json.dumps(state["analyzed_chunks"], indent=2)
        },
        result_key="integration_decisions",
        next_stage="complete"
    )


 