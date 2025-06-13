"""
Node functions for VoiceTree LangGraph workflow
Each node represents a stage in the processing pipeline
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
import logging

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


# Import the LLM integration
try:
    from backend.agentic_workflows.llm_integration import call_llm
except ImportError:
    # If running from a different directory, try relative import
    try:
        from llm_integration import call_llm
    except ImportError:
        print("⚠️ Could not import LLM integration - using mock implementation")
        
        # Fallback mock implementation
        def call_llm(prompt: str) -> str:
            """Mock LLM call for testing"""
            print(f"=== MOCK LLM CALL (FALLBACK) ===")
            print(f"Prompt length: {len(prompt)} characters")
            print(f"Prompt preview: {prompt[:100]}...")
            print("===================")
            return "Mock response"


# Constants
PROMPT_DIR = Path(__file__).parent / "prompts"
MAX_NODE_NAME_LENGTH = 100
EXCLUDED_PHRASES = ["based on", "provided data", "new nodes"]


def extract_json_from_response(response: str) -> str:
    """
    Extract JSON from a response that might be wrapped in markdown code blocks.
    This function is designed to be resilient to variations in model output.
    
    Args:
        response: LLM response that may contain JSON in markdown blocks
        
    Returns:
        Extracted JSON string
    """
    if not response or not isinstance(response, str):
        return "{}"
    
    # Remove common markdown code block markers
    response = response.strip()
    if response.startswith("```json"):
        response = response[7:]
    elif response.startswith("```"):
        response = response[3:]
    if response.endswith("```"):
        response = response[:-3]
    
    response = response.strip()
    
    # Find the first occurrence of '{' or '['
    start_bracket = -1
    for i, char in enumerate(response):
        if char in ['{', '[']:
            start_bracket = i
            break
            
    if start_bracket == -1:
        # No JSON object or array found, try to construct a valid response
        print(f"⚠️ No JSON brackets found in response: {response[:100]}...")
        return "{}"

    # Find the last occurrence of '}' or ']'
    end_bracket = -1
    bracket_pairs = {'{': '}', '[': ']'}
    expected_end = bracket_pairs.get(response[start_bracket])
    
    for i in range(len(response) - 1, -1, -1):
        if response[i] == expected_end:
            end_bracket = i
            break
            
    if end_bracket == -1:
        # No closing bracket found, try to add one
        print(f"⚠️ No closing bracket found in response: {response[:100]}...")
        expected_end = '}' if response[start_bracket] == '{' else ']'
        response = response[start_bracket:] + expected_end
        return response

    # Extract the potential JSON string
    json_str = response[start_bracket : end_bracket + 1]
    
    # Basic validation to ensure it's likely JSON
    try:
        json.loads(json_str)
        return json_str
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON validation failed: {e}")
        print(f"⚠️ Extracted JSON: {json_str[:200]}...")
        # Try to fix common JSON issues
        fixed_json = _try_fix_json(json_str)
        if fixed_json:
            return fixed_json
        # Fallback to empty JSON for the expected structure
        return "{}"

def _try_fix_json(json_str: str) -> str:
    """
    Try to fix common JSON formatting issues
    
    Args:
        json_str: Potentially malformed JSON string
        
    Returns:
        Fixed JSON string or None if unfixable
    """
    try:
        # Try removing trailing commas
        fixed = re.sub(r',(\s*[}\]])', r'\1', json_str)
        json.loads(fixed)
        return fixed
    except json.JSONDecodeError:
        pass
    
    try:
        # Try adding missing quotes around keys
        fixed = re.sub(r'(\w+):', r'"\1":', json_str)
        json.loads(fixed)
        return fixed
    except json.JSONDecodeError:
        pass
    
    return None


def load_prompt_template(prompt_name: str) -> str:
    """
    Load a prompt template from the prompts directory
    
    Args:
        prompt_name: Name of the prompt file (without .txt extension)
        
    Returns:
        Prompt template content
        
    Raises:
        FileNotFoundError: If prompt template doesn't exist
    """
    prompt_path = PROMPT_DIR / f"{prompt_name}.txt"
    
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt template not found: {prompt_path}")
    
    with open(prompt_path, 'r', encoding='utf-8') as f:
        return f.read()


def process_llm_stage(
    state: Dict[str, Any],
    stage_name: str,
    prompt_name: str,
    prompt_kwargs: Dict[str, Any],
    result_key: str,
    next_stage: str
) -> Dict[str, Any]:
    """
    Generic function to process an LLM stage
    
    Args:
        state: Current pipeline state
        stage_name: Display name for the stage
        prompt_name: Name of the prompt template to use
        prompt_kwargs: Arguments to format the prompt template
        result_key: Key to store the result in state
        next_stage: Name of the next stage
        
    Returns:
        Updated state dictionary
    """
    print(f"🔵 Stage: {stage_name}")
    
    try:
        # Load and format prompt
        prompt_template = load_prompt_template(prompt_name)
        prompt = prompt_template.format(**prompt_kwargs)
        
        # Log input prompt
        log_to_file(stage_name, "INPUT_PROMPT", prompt)
        
        # Call LLM
        response = call_llm(prompt)
        
        # Log raw LLM response
        log_to_file(stage_name, "RAW_LLM_RESPONSE", response)
        
        # Parse JSON response
        json_content = extract_json_from_response(response)
        
        # Log extracted JSON
        log_to_file(stage_name, "EXTRACTED_JSON", json_content)
        
        # Debug logging for segmentation issues
        if stage_name == "Segmentation" and len(json_content) < 50:
            print(f"⚠️ Short JSON content extracted: {json_content[:50]}...")
            print(f"⚠️ Original response preview: {response[:200]}...")
        
        try:
            result = json.loads(json_content)
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            print(f"❌ JSON content: {json_content[:200]}...")
            raise
        
        # Handle both dict and list responses
        if isinstance(result, dict) and result_key in result:
            result = result[result_key]
        elif isinstance(result, dict) and not result:
            # Empty dict, return empty result appropriate for the stage
            if result_key == "chunks":
                result = []
            elif result_key in ["analyzed_chunks", "integration_decisions"]:
                result = []
            else:
                result = []
        
        # Log the final result
        log_to_file(stage_name, "FINAL_RESULT", str(result)[:500] + "..." if len(str(result)) > 500 else str(result))
        
        return {
            **state,
            result_key: result,
            "current_stage": next_stage
        }
        
    except Exception as e:
        return {
            **state,
            "current_stage": "error",
            "error_message": f"{stage_name} failed: {str(e)}"
        }


def segmentation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Stage 1: Segment transcript into atomic idea chunks"""
    # First do the standard segmentation
    result = process_llm_stage(
        state=state,
        stage_name="Segmentation",
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
    return process_llm_stage(
        state=state,
        stage_name="Relationship Analysis",
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
    return process_llm_stage(
        state=state,
        stage_name="Integration Decision",
        prompt_name="integration_decision",
        prompt_kwargs={
            "analyzed_sub_chunks": json.dumps(state["analyzed_chunks"], indent=2)
        },
        result_key="integration_decisions",
        next_stage="integration_decision_complete"
    )


def extract_node_names(response: str) -> List[str]:
    """
    Extract node names from various response formats
    
    Args:
        response: LLM response containing node names
        
    Returns:
        List of extracted and filtered node names
    """
    new_nodes = []
    
    # Try to find bullet points with node names
    bullet_matches = re.findall(r'[*•]\s*([^\n*•]+)', response)
    if bullet_matches:
        new_nodes = [node.strip() for node in bullet_matches if node.strip()]
    else:
        # Fallback: try comma-separated values
        new_nodes = [node.strip() for node in response.split(",") if node.strip()]
    
    # Filter out invalid nodes
    return [
        node for node in new_nodes
        if len(node) < MAX_NODE_NAME_LENGTH
        and not any(phrase in node.lower() for phrase in EXCLUDED_PHRASES)
    ]


def node_extraction_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Stage 4: Extract new node names from integration decisions"""
    stage_name = "Node Extraction"
    print(f"🔵 Stage: {stage_name}")

    try:
        # Get existing node names to avoid re-creating them
        if isinstance(state.get("existing_nodes"), str):
            existing_node_names = [
                line.split("-")[0].strip()
                for line in state["existing_nodes"].split("\n")
                if line.strip()
            ]
        else:
            existing_node_names = []
            
        # Format the prompt
        prompt_template = load_prompt_template("node_extraction")
        prompt_kwargs = {
            "extract": json.dumps(state["integration_decisions"], indent=2),
            "nodes": "\n".join(existing_node_names),
        }
        prompt = prompt_template.format(**prompt_kwargs)
        
        # Log input prompt
        log_to_file(stage_name, "INPUT_PROMPT", prompt)
        
        # Call LLM
        response = call_llm(prompt)

        # Log raw response
        log_to_file(stage_name, "RAW_LLM_RESPONSE", response)
        
        # Extract names from response
        new_nodes = extract_node_names(response)

        # Log extracted names
        log_to_file(stage_name, "EXTRACTED_NAMES", ", ".join(new_nodes))
        
        return {
            **state,
            "new_nodes": new_nodes,
            "current_stage": "complete",
        }
    except Exception as e:
        return {
            **state,
            "current_stage": "error",
            "error_message": f"{stage_name} failed: {str(e)}",
        } 