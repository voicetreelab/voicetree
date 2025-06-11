"""
Node functions for VoiceTree LangGraph workflow
Each node represents a stage in the processing pipeline
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

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
    Extract JSON from a response that might be wrapped in markdown code blocks
    
    Args:
        response: LLM response that may contain JSON in markdown blocks
        
    Returns:
        Extracted JSON string
    """
    # First try to find JSON within markdown code blocks
    json_match = re.search(r'```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```', response, re.DOTALL)
    if json_match:
        return json_match.group(1).strip()
    
    # If no code blocks found, try to find JSON directly
    json_match = re.search(r'(\{.*\}|\[.*\])', response, re.DOTALL)
    if json_match:
        return json_match.group(1).strip()
    
    # If no JSON found, return the original response
    return response.strip()


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
        
        # Call LLM
        response = call_llm(prompt)
        
        # Parse JSON response
        json_content = extract_json_from_response(response)
        result = json.loads(json_content)
        
        # Handle both dict and list responses
        if isinstance(result, dict) and result_key in result:
            result = result[result_key]
        
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
    """Stage 4: Extract only the new nodes that should be created"""
    print("🔵 Stage: Node Extraction")
    
    try:
        # If there are no integration decisions, return empty list
        if not state.get("integration_decisions"):
            print("   ℹ️  No integration decisions to process")
            return {
                **state,
                "new_nodes": [],
                "current_stage": "complete"
            }
        
        # Load and format prompt
        prompt_template = load_prompt_template("node_extraction")
        prompt = prompt_template.format(
            extract=json.dumps(state["integration_decisions"], indent=2),
            nodes=state["existing_nodes"]
        )
        
        # Call LLM
        response = call_llm(prompt)
        
        # Extract node names
        new_nodes = extract_node_names(response)
        
        # Filter out any error messages or invalid nodes
        valid_nodes = []
        for node in new_nodes:
            # Skip nodes that look like error messages
            if any(phrase in node.lower() for phrase in ["no output", "no entries", "empty", "error", "integration decisions"]):
                continue
            # Skip parenthetical expressions
            if node.startswith("(") and node.endswith(")"):
                continue
            valid_nodes.append(node)
        
        return {
            **state,
            "new_nodes": valid_nodes,
            "current_stage": "complete"
        }
        
    except Exception as e:
        return {
            **state,
            "current_stage": "error",
            "error_message": f"Node extraction failed: {str(e)}"
        } 