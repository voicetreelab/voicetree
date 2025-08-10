#!/usr/bin/env python3
"""
Claude Code hook to remind about checking for tree updates and using add_new_node.py.
Runs on UserPromptSubmit to provide context about recent tree changes.
Uses per-agent CSV state tracking to show only new files.
"""

import json
import sys
import os
import csv
from pathlib import Path
from datetime import datetime

def get_agent_state_file(agent_name):
    """Get the CSV state file path for this agent."""
    # Use agent name for unique tracking, fallback to color for backward compatibility
    return Path(f"seen_nodes_{agent_name}.csv")

def load_seen_files(state_file):
    """Load previously seen files from CSV."""
    seen_files = set()
    if state_file.exists():
        try:
            with open(state_file, 'r', newline='') as f:
                reader = csv.reader(f)
                for row in reader:
                    if row:  # Skip empty rows
                        seen_files.add(row[0])  # filepath is first column
        except Exception:
            pass
    return seen_files

def save_seen_files(state_file, new_files):
    """Append new files to CSV state file."""
    try:
        with open(state_file, 'a', newline='') as f:
            writer = csv.writer(f)
            timestamp = datetime.now().isoformat()
            for filepath in new_files:
                writer.writerow([filepath, timestamp])
    except Exception:
        pass

def get_new_nodes(vault_path, agent_name):
    """Find new markdown files this agent hasn't seen before."""
    state_file = get_agent_state_file(agent_name)
    seen_files = load_seen_files(state_file)
    
    new_nodes = []
    try:
        vault = Path(vault_path)
        if vault.exists():
            current_files = set()
            for md_file in vault.rglob("*.md"):
                rel_path = str(md_file.relative_to(vault))
                current_files.add(rel_path)
                if rel_path not in seen_files:
                    new_nodes.append(rel_path)
            
            # Save new files to state
            if new_nodes:
                save_seen_files(state_file, new_nodes)
                
    except Exception:
        pass
    
    return new_nodes[:5]  # Return max 5 most recent

def is_orchestrator_task(source_note):
    """Check if this looks like an orchestrator task based on filename patterns."""
    if not source_note:
        return False
    
    orchestrator_patterns = [
        'orchestrat', 'manager', 'coordinate', 'delegate', 'split', 'decompose'
    ]
    
    note_lower = source_note.lower()
    return any(pattern in note_lower for pattern in orchestrator_patterns)

def main():
    # Read the hook input from stdin
    try:
        hook_input = json.load(sys.stdin)
        # Debug: save the input to see what Claude sends
        with open('/tmp/hook_debug.json', 'w') as f:
            json.dump(hook_input, f, indent=2)
    except:
        hook_input = {}
    
    # Get the hook event name from the input
    # Claude uses 'hook_event_name' not 'hookEvent'
    hook_event = hook_input.get('hook_event_name', hook_input.get('hookEvent', 'UserPromptSubmit'))
    
    # Get environment variables
    agent_name = os.environ.get('AGENT_NAME', None)
    agent_color = os.environ.get('AGENT_COLOR', 'blue')
    vault_path = os.environ.get('OBSIDIAN_VAULT_PATH', 'markdownTreeVault')
    source_note = os.environ.get('OBSIDIAN_SOURCE_NOTE', '')
    
    # Use agent name if available, otherwise fallback to color for backward compatibility
    agent_identifier = agent_name if agent_name else agent_color
    
    # Determine if this is an orchestrator or regular agent
    is_orchestrator = is_orchestrator_task(source_note)
    
    # Check for new tree updates this agent hasn't seen
    new_nodes = get_new_nodes(vault_path, agent_identifier)
    
    # Build reminder message
    messages = []
    
    if agent_name:
        messages.append(f"👤 Agent: {agent_name} (color: {agent_color})")
    else:
        messages.append(f"🎨 Your color: {agent_color}")
    
    if is_orchestrator:
        # Orchestrator-specific reminders
        messages.append("👥 ORCHESTRATOR MODE - Creating subtasks:")
        messages.append("📝 Create subtasks: python tools/add_new_node.py <parent> <name> <desc> is_subtask_of --color <color>")
        messages.append("💡 Assign unique colors to each subagent (green, blue, purple, etc.)")
    else:
        # Regular agent reminders
        messages.append("📝 Add progress: python tools/add_new_node.py <parent> <name> <content> <relationship>")
        messages.append("💡 Your color is inherited - no need to specify it")
    
    if new_nodes:
        messages.append(f"🌳 New updates for you: {', '.join(new_nodes)}")
    
    if source_note:
        messages.append(f"📍 Context: {source_note}")
    
    
    # Return appropriate format based on the hook event
    if hook_event == "Stop":
        # For Stop event, check if there are important new nodes to review
        if new_nodes and len(new_nodes) > 0:
            # Block the stop if there are new nodes that might be relevant
            important_nodes = [n for n in new_nodes if 'update' in n.lower() or 'requirement' in n.lower() or 'urgent' in n.lower()]
            
            if important_nodes:
                # Read the content of important nodes to show the agent
                node_contents = []
                for node in important_nodes[:2]:  # Limit to first 2 important nodes
                    try:
                        node_path = Path(vault_path) / node
                        if node_path.exists():
                            with open(node_path, 'r') as f:
                                content = f.read()
                                # Extract just the main content after frontmatter
                                if '---' in content:
                                    parts = content.split('---', 2)
                                    if len(parts) > 2:
                                        content = parts[2].strip()
                                node_contents.append(f"📌 {node}:\n{content[:500]}")  # First 500 chars
                    except:
                        pass
                
                if node_contents:
                    print(json.dumps({
                        "decision": "block",  # Block the stop
                        "reason": f"⚠️ IMPORTANT: New nodes detected that may affect your task!\n\n" + 
                                 "\n\n".join(node_contents) + 
                                 "\n\n🔄 Please review these updates and modify your work if needed, then you may stop."
                    }))
                    sys.exit(0)
        
        # Don't block if no important new nodes - return approve decision
        print(json.dumps({
            "decision": "approve",  # Allow the stop (not "null")
            "reason": "\n".join(messages) if messages else "No new important updates"
        }))
        sys.exit(0)
    else:
        # For UserPromptSubmit, use the hookSpecificOutput format
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",  # Must be exactly "UserPromptSubmit"
                "additionalContext": "\n".join(messages)
            }
        }))
        sys.exit(0)

if __name__ == "__main__":
    main()