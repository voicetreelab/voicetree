"""
Debug logging system for VoiceTree workflow stages
Logs input/output variables to individual files for each stage
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from typing import Dict

# Create debug logs directory at the agentic_workflows level for better visibility
DEBUG_DIR = Path(__file__).parent.parent / "debug_logs"
DEBUG_DIR.mkdir(exist_ok=True)

def clear_debug_logs():
    """
    Clear all existing debug log files.
    
    Note: This should only be called manually when starting a new benchmarker session.
    Individual transcript runs will append to existing logs to preserve the full history.
    """
    if DEBUG_DIR.exists():
        for file in DEBUG_DIR.glob("*.txt"):
            file.unlink()
    print(f"🗑️ Cleared debug logs in {DEBUG_DIR}")
    
def log_stage_input_output(stage_name: str, inputs: Dict[str, Any], outputs: Dict[str, Any]):
    """
    Log the state before and after a workflow stage execution
    
    Args:
        stage_name: Name of the stage (e.g., "segmentation", "relationship_analysis")
        inputs: State dictionary before the stage executes
        outputs: State dictionary after the stage executes
    """
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_file = DEBUG_DIR / f"{stage_name}_debug.txt"
    
    # Format the log entry
    log_entry = f"""
==========================================
{stage_name.upper()} STAGE DEBUG - {timestamp}
==========================================

STATE BEFORE:
{format_variables(inputs)}

STATE AFTER:
{format_variables(outputs)}

==========================================

"""
    
    # Append to the stage's debug file
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(log_entry)
    

def format_variables(variables: Dict[str, Any]) -> str:
    """
    Format variables for readable logging
    
    Args:
        variables: Dictionary of variables to format
        
    Returns:
        Formatted string representation
    """
    formatted_lines = []
    
    for key, value in variables.items():
        if key in ["current_stage", "error_message"]:
            # Skip internal workflow variables
            continue
            
        if isinstance(value, str):
            # Truncate very long strings
            if len(value) > 3000:
                formatted_value = value[:3000] + "...[DEBUG_TRUNCATED]"
            else:
                formatted_value = value
            formatted_lines.append(f"  {key}: {repr(formatted_value)}")
            
        elif isinstance(value, list):
            # Format lists nicely - show ALL items without truncation
            if len(value) == 0:
                formatted_lines.append(f"  {key}: []")
            else:
                # Show all items in the list
                formatted_lines.append(f"  {key}: [{len(value)} items]")
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        formatted_lines.append(f"    {i}: {format_dict_compact(item)}")
                    elif hasattr(item, 'model_dump'):
                        # Handle Pydantic models
                        formatted_lines.append(f"    {i}: {format_dict_compact(item.model_dump())}")
                    else:
                        formatted_lines.append(f"    {i}: {repr(item)}")
                formatted_lines.append("  ]")
                
        elif isinstance(value, dict):
            # Format dictionaries compactly
            formatted_lines.append(f"  {key}: {format_dict_compact(value)}")
            
        else:
            # Other types (numbers, booleans, etc.)
            formatted_lines.append(f"  {key}: {repr(value)}")
    
    return "\n".join(formatted_lines) if formatted_lines else "  (no variables)"

def format_dict_compact(d: Dict[str, Any]) -> str:
    """
    Format a dictionary showing all items
    
    Args:
        d: Dictionary to format
        
    Returns:
        Compact string representation
    """
    if not d:
        return "{}"
    
    # Handle Pydantic models by converting to dict
    if hasattr(d, 'model_dump'):
        d = d.model_dump()
    
    items = list(d.items())
    # Show all items without truncation
    formatted_items = []
    for k, v in items:
        if isinstance(v, str) and len(v) > 3000:
            v_str = repr(v[:3000] + "...[DEBUG_TRUNCATED]")
        else:
            v_str = repr(v)
        formatted_items.append(f"{repr(k)}: {v_str}")
    return "{" + ", ".join(formatted_items) + "}"

def log_transcript_processing(transcript_text: str, file_source: str = "unknown"):
    """
    Log the initial transcript being processed
    
    Args:
        transcript_text: The transcript text
        file_source: Source file path or description
    """
    # Don't clear logs automatically - preserve all executions during benchmarker runs
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_file = DEBUG_DIR / "00_transcript_input.txt"
    
    # Add a separator for new execution without clearing previous logs
    separator = f"""

##########################################################
# NEW TRANSCRIPT EXECUTION - {timestamp}
##########################################################

"""
    
    log_entry = f"""
==========================================
TRANSCRIPT INPUT - {timestamp}
==========================================

SOURCE: {file_source}
LENGTH: {len(transcript_text)} characters
WORD COUNT: {len(transcript_text.split())} words

CONTENT:
{transcript_text}

==========================================

"""
    
    # Append to file instead of overwriting
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(separator)
        f.write(log_entry)
    

def log_llm_io(stage_name: str, prompt: str, response: Any, model_name: str = "unknown"):
    """
    Log the actual LLM prompt and response for debugging
    
    Args:
        stage_name: Name of the stage (e.g., "single_abstraction_optimizer")
        prompt: The full prompt sent to the LLM
        response: The LLM response (can be string or structured object)
        model_name: The model that was used
    """
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_file = DEBUG_DIR / f"{stage_name}_llm_io.txt"
    
    # Format response based on type
    if hasattr(response, 'model_dump'):
        # Pydantic model
        response_str = json.dumps(response.model_dump(), indent=2)
    elif isinstance(response, dict):
        response_str = json.dumps(response, indent=2)
    else:
        response_str = str(response)
    
    log_entry = f"""
==========================================
{stage_name.upper()} LLM I/O - {timestamp}
==========================================

MODEL: {model_name}

PROMPT SENT TO LLM:
------------------
{prompt}
------------------

LLM RESPONSE:
------------
{response_str}
------------

==========================================

"""
    
    # Append to the stage's LLM I/O debug file
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(log_entry)


def create_debug_summary():
    """
    Create a summary of all debug logs
    """
    timestamp = datetime.now().strftime("%H:%M:%S")
    summary_file = DEBUG_DIR / "99_debug_summary.txt"
    
    log_files = sorted([f for f in DEBUG_DIR.glob("*.txt") if f.name != "99_debug_summary.txt"])
    
    summary_content = f"""
==========================================
WORKFLOW DEBUG SUMMARY - {timestamp}
==========================================

Available Debug Logs:
"""
    
    for log_file in log_files:
        file_size = log_file.stat().st_size
        summary_content += f"  - {log_file.name} ({file_size} bytes)\n"
    
    summary_content += f"""
Total Debug Files: {len(log_files)}

To investigate the workflow issue:

1. Start with 00_transcript_input.txt to see ALL transcript inputs (logs accumulate across runs)
2. Check segmentation_debug.txt to see if chunks are correct
3. Check relationship_analysis_debug.txt to see if relationships are found
4. Check integration_decision_debug.txt to see if decisions make sense

NOTE: Debug logs now accumulate across multiple runs. Look for separator lines
with timestamps to distinguish between different executions.

Look for where the content starts to diverge from the original transcript.

==========================================
"""

    with open(summary_file, "w", encoding="utf-8") as f:
        f.write(summary_content)
    
    # print(f"📋 Created debug summary at {summary_file.name}")
    # print(f"🔍 Debug logs available in: {DEBUG_DIR}") 