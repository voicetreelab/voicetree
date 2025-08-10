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

def get_agent_state_file(agent_color):
    """Get the CSV state file path for this agent."""
    return Path(f"seen_nodes_{agent_color}.csv")

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

def get_new_nodes(vault_path, agent_color):
    """Find new markdown files this agent hasn't seen before."""
    state_file = get_agent_state_file(agent_color)
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
    hook_input = json.load(sys.stdin)
    
    # Get environment variables
    agent_color = os.environ.get('AGENT_COLOR', 'blue')
    vault_path = os.environ.get('OBSIDIAN_VAULT_PATH', 'markdownTreeVault')
    source_note = os.environ.get('OBSIDIAN_SOURCE_NOTE', '')
    
    # Determine if this is an orchestrator or regular agent
    is_orchestrator = is_orchestrator_task(source_note)
    
    # Check for new tree updates this agent hasn't seen
    new_nodes = get_new_nodes(vault_path, agent_color)
    
    # Build reminder message
    messages = []
    
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
    
    
    # Return the reminder as a system message
    print(json.dumps({
        "action": "message",
        "message": "\n".join(messages)
    }))

if __name__ == "__main__":
    main()