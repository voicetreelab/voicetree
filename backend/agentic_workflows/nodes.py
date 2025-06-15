#!/usr/bin/env python3
"""
VoiceTree LangGraph Pipeline Nodes
Implements the 4-stage workflow: Segmentation → Relationship Analysis → Integration Decision → Node Extraction
"""

import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

# Add project root and backend directory to Python path for imports
current_file = Path(__file__)
project_root = current_file.parent.parent.parent  # Go up from backend/agentic_workflows/nodes.py to root
backend_dir = current_file.parent.parent  # Go up to backend directory
agentic_workflows_dir = current_file.parent  # Current directory

for path_to_add in [str(project_root), str(backend_dir), str(agentic_workflows_dir)]:
    if path_to_add not in sys.path:
        sys.path.insert(0, path_to_add)

print(f"🔧 Added paths to sys.path:")
print(f"   Project root: {project_root}")
print(f"   Backend dir: {backend_dir}")
print(f"   Agentic workflows: {agentic_workflows_dir}")

import json
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

# Import the LLM integration and debug logger with comprehensive error handling
llm_imported = False
import_source = ""
import_error_details = []

# Try direct import first (when running from agentic_workflows directory)
try:
    from llm_integration import call_llm_structured, call_llm
    from debug_logger import log_stage_input_output, log_transcript_processing
    llm_imported = True
    import_source = "direct relative"
    print(f"✅ LLM integration loaded from {import_source}")
except ImportError as e1:
    import_error_details.append(f"direct relative: {e1}")
    
    # Try backend.agentic_workflows path
    try:
        from backend.agentic_workflows.llm_integration import call_llm_structured, call_llm
        from backend.agentic_workflows.debug_logger import log_stage_input_output, log_transcript_processing
        llm_imported = True
        import_source = "backend.agentic_workflows"
        print(f"✅ LLM integration loaded from {import_source}")
    except ImportError as e2:
        import_error_details.append(f"backend.agentic_workflows: {e2}")
        
        # Try agentic_workflows path  
        try:
            from backend.agentic_workflows.llm_integration import call_llm_structured, call_llm
            from backend.agentic_workflows.debug_logger import log_stage_input_output, log_transcript_processing
            llm_imported = True
            import_source = "agentic_workflows"
            print(f"✅ LLM integration loaded from {import_source}")
        except ImportError as e3:
            import_error_details.append(f"agentic_workflows: {e3}")
            llm_imported = False

if not llm_imported:
    print(f"❌ LLM integration import failed! Using mock implementation.")
    print(f"   Import attempts:")
    for error in import_error_details:
        print(f"     • {error}")
    print(f"   Current working directory: {os.getcwd()}")
    print(f"   Python paths (first 3): {sys.path[:3]}")
    
    # Mock debug logging
    def log_stage_input_output(stage_name: str, inputs: dict, outputs: dict):
        print(f"📝 (Mock) Would log {stage_name} I/O")
    
    def log_transcript_processing(transcript_text: str, file_source: str = "unknown"):
        print(f"📝 (Mock) Would log transcript input")
    
    # Fallback mock implementation
    def call_llm_structured(prompt: str, stage_type: str):
        """Mock structured LLM call for testing"""
        print(f"=== MOCK STRUCTURED LLM CALL (FALLBACK) ===")
        print(f"Stage: {stage_type}")
        print(f"Prompt length: {len(prompt)} characters")
        print("===================")
        
        # Try to import Pydantic models for proper mock responses
        try:
            # Try different import paths for schema models
            schema_models = None
            for schema_import in ["schema_models", "agentic_workflows.schema_models", "backend.agentic_workflows.schema_models"]:
                try:
                    schema_models = __import__(schema_import, fromlist=['SegmentationResponse', 'RelationshipResponse', 'IntegrationResponse', 'NodeExtractionResponse', 'ChunkModel'])
                    break
                except ImportError:
                    continue
            
            if schema_models:
                # Return proper mock Pydantic models based on stage type
                if stage_type == "segmentation":
                    return schema_models.SegmentationResponse(
                        chunks=[schema_models.ChunkModel(name="Mock Chunk", text="Mock text", is_complete=True)]
                    )
                elif stage_type == "relationship":
                    return schema_models.RelationshipResponse(analyzed_chunks=[])
                elif stage_type == "integration":
                    return schema_models.IntegrationResponse(integration_decisions=[])
                elif stage_type == "extraction":
                    return schema_models.NodeExtractionResponse(new_nodes=[])
                else:
                    # Fallback to dict for unknown stages
                    return {"mock": "response"}
            else:
                # If schema imports fail, return dict (will cause error but at least we'll know why)
                print("❌ Could not import schema models for mock response")
                return {"mock": "response"}
                
        except Exception as e:
            print(f"❌ Error creating mock response: {e}")
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
        # Load and format prompt
        prompt_template = load_prompt_template(prompt_name)
        prompt = prompt_template.format(**prompt_kwargs)
        
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
    
    # Check for empty or too short transcript first
    transcript_raw = state.get("transcript_text", "")
    
    # Handle case where transcript_text might be a dict or other type
    if isinstance(transcript_raw, dict):
        transcript = transcript_raw.get("text", str(transcript_raw)).strip()
    elif isinstance(transcript_raw, str):
        transcript = transcript_raw.strip()
    else:
        transcript = str(transcript_raw).strip()
    
    # Return error for empty transcript
    if not transcript:
        return {
            **state,
            "current_stage": "error",
            "error_message": "Empty transcript provided for segmentation"
        }
    
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
    
    # Validate and filter chunks
    if result.get("chunks") and result["current_stage"] != "error":
        chunks = result["chunks"]
        valid_chunks = []
        
        for chunk in chunks:
            # Check minimum content requirements
            text = chunk.get("text", "")
            name = chunk.get("name", "")
            
            # Filter out chunks that are too short or have no name
            if len(text.strip()) >= 30 and len(name.strip()) >= 3:
                valid_chunks.append(chunk)
            else:
                print(f"   ⚠️ Filtered out invalid chunk: name='{name}', text_length={len(text)}")
        
        # If no valid chunks remain, use fallback
        if not valid_chunks:
            print("   ⚠️ No valid chunks after filtering, using fallback")
            valid_chunks = [{
                "name": "Voice Input",
                "text": transcript,
                "is_complete": True
            }]
        
        result["chunks"] = valid_chunks
        
        # Prevent over-fragmentation by merging if too many chunks
        if len(valid_chunks) > 15:
            print(f"   ⚠️ Too many chunks ({len(valid_chunks)}), merging to prevent over-fragmentation")
            merged_chunks = []
            current_merge = {"names": [], "texts": []}
            
            for i, chunk in enumerate(valid_chunks):
                current_merge["names"].append(chunk["name"])
                current_merge["texts"].append(chunk["text"])
                
                # Merge every 2-3 chunks or at the end
                if len(current_merge["names"]) >= 2 or i == len(valid_chunks) - 1:
                    merged_chunk = {
                        "name": " & ".join(current_merge["names"]),
                        "text": " ".join(current_merge["texts"]),
                        "is_complete": True
                    }
                    merged_chunks.append(merged_chunk)
                    current_merge = {"names": [], "texts": []}
            
            result["chunks"] = merged_chunks[:15]  # Cap at 15 chunks
        
        chunks = result["chunks"]
        print(f"   ✅ Processing {len(chunks)} complete chunks")
    
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
    
    # Use the reliable fallback approach: extract directly from integration decisions
    print("🔄 Using direct extraction from integration decisions (bypassing LLM schema issues)")
    
    fallback_nodes = []
    integration_decisions = state.get("integration_decisions", [])
    
    for decision in integration_decisions:
        if decision.get("action") == "CREATE" and decision.get("new_node_name"):
            node_name = decision["new_node_name"]
            # Apply same filtering as LLM approach
            if (len(node_name) < MAX_NODE_NAME_LENGTH and 
                not any(phrase in node_name.lower() for phrase in EXCLUDED_PHRASES)):
                fallback_nodes.append(node_name)
    
    print(f"   ✅ Extracted {len(fallback_nodes)} nodes from integration decisions: {fallback_nodes}")
    
    result = {
        **state,
        "new_nodes": fallback_nodes,
        "current_stage": "complete"
    }
    
    return result 