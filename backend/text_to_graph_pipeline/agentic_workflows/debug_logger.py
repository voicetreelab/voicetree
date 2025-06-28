"""
Debug logging system for VoiceTree workflow stages
Logs input/output variables to individual files for each stage
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

# Create debug logs directory
DEBUG_DIR = Path(__file__).parent / "debug_logs"
DEBUG_DIR.mkdir(exist_ok=True)

def clear_debug_logs():
    """Clear all existing debug log files"""
    if DEBUG_DIR.exists():
        for file in DEBUG_DIR.glob("*.txt"):
            file.unlink()
    print(f"🗑️ Cleared debug logs in {DEBUG_DIR}")

def log_stage_input_output(stage_name: str, inputs: Dict[str, Any], outputs: Dict[str, Any]):
    """
    Log the input and output variables for a workflow stage
    
    Args:
        stage_name: Name of the stage (e.g., "segmentation", "relationship_analysis")
        inputs: Dictionary of input variables passed to the stage
        outputs: Dictionary of output variables from the stage
    """
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_file = DEBUG_DIR / f"{stage_name}_debug.txt"
    
    # Format the log entry
    log_entry = f"""
==========================================
{stage_name.upper()} STAGE DEBUG - {timestamp}
==========================================

INPUT VARIABLES:
{format_variables(inputs)}

OUTPUT VARIABLES:
{format_variables(outputs)}

==========================================

"""
    
    # Append to the stage's debug file
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(log_entry)
    
    print(f"📝 Logged {stage_name} I/O to {log_file.name}")

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
            if len(value) > 1000:
                formatted_value = value[:1000] + "...[DEBUG_TRUNCATED]"
            else:
                formatted_value = value
            formatted_lines.append(f"  {key}: {repr(formatted_value)}")
            
        elif isinstance(value, list):
            # Format lists nicely
            if len(value) == 0:
                formatted_lines.append(f"  {key}: []")
            elif len(value) <= 3:
                # Show small lists completely
                formatted_lines.append(f"  {key}: [")
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        formatted_lines.append(f"    {i}: {format_dict_compact(item)}")
                    else:
                        formatted_lines.append(f"    {i}: {repr(item)}")
                formatted_lines.append("  ]")
            else:
                # Show first few items of large lists
                formatted_lines.append(f"  {key}: [{len(value)} items]")
                for i in range(min(2, len(value))):
                    item = value[i]
                    if isinstance(item, dict):
                        formatted_lines.append(f"    {i}: {format_dict_compact(item)}")
                    else:
                        formatted_lines.append(f"    {i}: {repr(item)}")
                if len(value) > 2:
                    formatted_lines.append(f"    ... and {len(value) - 2} more items")
                formatted_lines.append("  ]")
                
        elif isinstance(value, dict):
            # Format dictionaries compactly
            formatted_lines.append(f"  {key}: {format_dict_compact(value)}")
            
        else:
            # Other types (numbers, booleans, etc.)
            formatted_lines.append(f"  {key}: {repr(value)}")
    
    return "\n".join(formatted_lines) if formatted_lines else "  (no variables)"

def format_dict_compact(d: Dict[str, Any], max_items: int = 3) -> str:
    """
    Format a dictionary in a compact way
    
    Args:
        d: Dictionary to format
        max_items: Maximum number of items to show
        
    Returns:
        Compact string representation
    """
    if not d:
        return "{}"
    
    items = list(d.items())
    if len(items) <= max_items:
        # Show all items
        formatted_items = []
        for k, v in items:
            if isinstance(v, str) and len(v) > 200:
                v_str = repr(v[:200] + "...[DEBUG_TRUNCATED]")
            else:
                v_str = repr(v)
            formatted_items.append(f"{repr(k)}: {v_str}")
        return "{" + ", ".join(formatted_items) + "}"
    else:
        # Show first few items
        formatted_items = []
        for k, v in items[:max_items]:
            if isinstance(v, str) and len(v) > 200:
                v_str = repr(v[:200] + "...[DEBUG_TRUNCATED]")
            else:
                v_str = repr(v)
            formatted_items.append(f"{repr(k)}: {v_str}")
        return "{" + ", ".join(formatted_items) + f", ...and {len(items) - max_items} more" + "}"

def log_transcript_processing(transcript_text: str, file_source: str = "unknown"):
    """
    Log the initial transcript being processed
    
    Args:
        transcript_text: The transcript text
        file_source: Source file path or description
    """
    # Clear all debug logs at the start of each new execution
    clear_debug_logs()
    
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_file = DEBUG_DIR / "00_transcript_input.txt"
    
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
    
    with open(log_file, "w", encoding="utf-8") as f:
        f.write(log_entry)
    
    print(f"📝 Logged transcript input to {log_file.name}")

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

1. Start with 00_transcript_input.txt to see the original input
2. Check segmentation_debug.txt to see if chunks are correct
3. Check relationship_analysis_debug.txt to see if relationships are found
4. Check integration_decision_debug.txt to see if decisions make sense

Look for where the content starts to diverge from the original transcript.

==========================================
"""
    
    with open(summary_file, "w", encoding="utf-8") as f:
        f.write(summary_content)
    
    print(f"📋 Created debug summary at {summary_file.name}")
    print(f"🔍 Debug logs available in: {DEBUG_DIR}") 