"""
Node functions for VoiceTree LangGraph workflow
Each node represents a stage in the processing pipeline
"""

import json
import os
import re
from pathlib import Path
from typing import Dict, Any

# Import the LLM integration
try:
    from llm_integration import call_llm
except ImportError:
    # If running from a different directory, try absolute import
    try:
        from workflow.langgraph.llm_integration import call_llm
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


def extract_json_from_response(response: str) -> str:
    """
    Extract JSON from a response that might be wrapped in markdown code blocks
    """
    # First try to find JSON within markdown code blocks
    json_match = re.search(r'```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```', response, re.DOTALL)
    if json_match:
        return json_match.group(1).strip()
    
    # If no code blocks found, try to find JSON directly
    # Look for content that starts with { or [
    json_match = re.search(r'(\{.*\}|\[.*\])', response, re.DOTALL)
    if json_match:
        return json_match.group(1).strip()
    
    # If no JSON found, return the original response
    return response.strip()


def load_prompt_template(prompt_name: str) -> str:
    """Load a prompt template from the prompts directory"""
    prompt_path = Path(__file__).parent / "prompts" / f"{prompt_name}.txt"
    
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt template not found: {prompt_path}")
    
    with open(prompt_path, 'r', encoding='utf-8') as f:
        return f.read()


def segmentation_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stage 1: Segment transcript into atomic idea chunks
    """
    print("🔵 Stage 1: Segmentation")
    
    try:
        # Load the segmentation prompt
        prompt_template = load_prompt_template("segmentation")
        prompt = prompt_template.format(transcript_text=state["transcript_text"])
        
        # Call LLM
        response = call_llm(prompt)
        
        # Parse JSON response - extract from markdown if needed
        json_content = extract_json_from_response(response)
        parsed_response = json.loads(json_content)
        chunks = parsed_response.get("chunks", [])
        
        return {
            **state,
            "chunks": chunks,
            "current_stage": "segmentation_complete"
        }
        
    except Exception as e:
        return {
            **state,
            "current_stage": "error",
            "error_message": f"Segmentation failed: {str(e)}"
        }


def relationship_analysis_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stage 2: Analyze relationships between chunks and existing nodes
    """
    print("🔵 Stage 2: Relationship Analysis")
    
    try:
        # Load the relationship analysis prompt
        prompt_template = load_prompt_template("relationship_analysis")
        prompt = prompt_template.format(
            existing_nodes=state["existing_nodes"],
            sub_chunks=json.dumps(state["chunks"], indent=2)
        )
        
        # Call LLM
        response = call_llm(prompt)
        
        # Parse JSON response - extract from markdown if needed
        json_content = extract_json_from_response(response)
        analyzed_chunks = json.loads(json_content)
        
        return {
            **state,
            "analyzed_chunks": analyzed_chunks,
            "current_stage": "relationship_analysis_complete"
        }
        
    except Exception as e:
        return {
            **state,
            "current_stage": "error",
            "error_message": f"Relationship analysis failed: {str(e)}"
        }


def integration_decision_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stage 3: Decide whether to APPEND or CREATE for each chunk
    """
    print("🔵 Stage 3: Integration Decision")
    
    try:
        # Load the integration decision prompt
        prompt_template = load_prompt_template("integration_decision")
        prompt = prompt_template.format(
            analyzed_sub_chunks=json.dumps(state["analyzed_chunks"], indent=2)
        )
        
        # Call LLM
        response = call_llm(prompt)
        
        # Parse JSON response - extract from markdown if needed
        json_content = extract_json_from_response(response)
        integration_decisions = json.loads(json_content)
        
        return {
            **state,
            "integration_decisions": integration_decisions,
            "current_stage": "integration_decision_complete"
        }
        
    except Exception as e:
        return {
            **state,
            "current_stage": "error", 
            "error_message": f"Integration decision failed: {str(e)}"
        }


def node_extraction_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stage 4: Extract only the new nodes that should be created
    """
    print("🔵 Stage 4: Node Extraction")
    
    try:
        # Load the node extraction prompt
        prompt_template = load_prompt_template("node_extraction")
        prompt = prompt_template.format(
            extract=json.dumps(state["integration_decisions"], indent=2),
            nodes=state["existing_nodes"]
        )
        
        # Call LLM
        response = call_llm(prompt)
        
        # Parse the response - extract node names from various formats
        new_nodes = []
        
        # Try to find bullet points with node names
        bullet_matches = re.findall(r'[*•]\s*([^\n*•]+)', response)
        if bullet_matches:
            new_nodes = [node.strip() for node in bullet_matches if node.strip()]
        else:
            # Fallback: try comma-separated values
            new_nodes = [node.strip() for node in response.split(",") if node.strip()]
            
        # Filter out any non-node text (like "Based on the provided data")
        filtered_nodes = []
        for node in new_nodes:
            # Skip nodes that are too long or contain common descriptive phrases
            if (len(node) < 100 and 
                "based on" not in node.lower() and 
                "provided data" not in node.lower() and
                "new nodes" not in node.lower()):
                filtered_nodes.append(node)
        
        return {
            **state,
            "new_nodes": filtered_nodes,
            "current_stage": "complete"
        }
        
    except Exception as e:
        return {
            **state,
            "current_stage": "error",
            "error_message": f"Node extraction failed: {str(e)}"
        } 