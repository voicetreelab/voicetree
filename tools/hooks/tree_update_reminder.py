#!/usr/bin/env python3
"""
Simple hook to track and report new tree nodes to agents.
"""

import json
import sys
import os
import csv
from pathlib import Path
from datetime import datetime

def get_agent_state_file(agent_name):
    """Get the CSV state file path for this agent."""
    script_dir = Path(__file__).parent.parent  # Go up from hooks/ to tools/
    state_dir = script_dir / "state"
    state_dir.mkdir(exist_ok=True, parents=True)
    return state_dir / f"seen_nodes_{agent_name}.csv"

def load_seen_files(state_file):
    """Load previously seen files from CSV."""
    seen_files = set()
    if state_file.exists():
        try:
            with open(state_file, 'r', newline='') as f:
                reader = csv.reader(f)
                for row in reader:
                    if row:
                        seen_files.add(row[0])
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

def mark_file_as_seen_by_agent(vault_path, file_path, agent_name):
    """Mark a specific file as seen by an agent to prevent hook notifications."""
    try:
        # Convert file_path to relative path from vault
        vault = Path(vault_path)
        file = Path(file_path)

        if file.is_absolute():
            # Get relative path from vault
            try:
                rel_path = str(file.relative_to(vault))
            except ValueError:
                # File not in vault, just use filename
                rel_path = file.name
        else:
            rel_path = str(file)

        # Get state file and save this file as seen
        state_file = get_agent_state_file(agent_name)
        save_seen_files(state_file, [rel_path])

    except Exception:
        # Silently fail - this is just optimization to prevent noise
        pass

def get_new_nodes(vault_path, agent_name, save_state=True):
    """Find new markdown files this agent hasn't seen before."""
    state_file = get_agent_state_file(agent_name)
    seen_files = load_seen_files(state_file)
    
    new_nodes = []
    try:
        vault = Path(vault_path)
        if vault.exists():
            for md_file in vault.rglob("*.md"):
                rel_path = str(md_file.relative_to(vault))
                if rel_path not in seen_files:
                    new_nodes.append(rel_path)
            
            # Save new files to state only if requested
            if new_nodes and save_state:
                save_seen_files(state_file, new_nodes)
                
    except Exception:
        pass
    
    return new_nodes

def main():
    # Read hook input
    try:
        hook_input = json.load(sys.stdin)
    except:
        hook_input = {}
    
    hook_event = hook_input.get('hook_event_name', 'UserPromptSubmit')
    
    # Debug logging
    with open('/tmp/hook_debug.log', 'a') as f:
        f.write(f"\n{datetime.now().isoformat()} - Hook called for {hook_event}\n")
    
    # Get environment variables
    agent_name = os.environ.get('AGENT_NAME', os.environ.get('AGENT_COLOR', 'default'))
    vault_path = os.environ.get('OBSIDIAN_VAULT_PATH', 'markdownTreeVault')
    
    # Check for new nodes (don't save state yet for UserPromptSubmit)
    new_nodes = get_new_nodes(vault_path, agent_name, save_state=(hook_event != "UserPromptSubmit"))
    
    # Debug logging
    with open('/tmp/hook_debug.log', 'a') as f:
        f.write(f"  Found {len(new_nodes)} new nodes for agent {agent_name}\n")
    
    # Build output based on event type
    if hook_event == "UserPromptSubmit":
        # Simple plain text output for context injection
        messages = []
        messages.append(f"Reminder for you, agent: {agent_name}")
        messages.append("Update existing nodes you have already written, or if it is worthy of a completely new progress file, add nodes concisely detailing your progress with `python VoiceTree/tools/add_new_node.py <parent_node_name> <new_node_name> <content> <relationship_to_parent>`")
        
        if new_nodes:
            messages.append(f"\n📌 NEW FILES DETECTED - Read these if potentially relevant to your task:")
            for node in new_nodes[:10]:  # Limit to 10 most recent
                messages.append(f"  • {node}")
            # Now save the state after we've built the message
            save_seen_files(get_agent_state_file(agent_name), new_nodes)
        
        print("\n".join(messages))
        sys.exit(0)

    elif hook_event == "Stop":
        # For Stop events, block if there are new relevant files
        if new_nodes:
            # Block stopping and tell me to review the new files
            print(json.dumps({
                "decision": "block",
                "reason": f"📌 NEW FILES DETECTED - Review these before stopping:\n" +
                         "\n".join([f"  • {node}" for node in new_nodes[:5]]) +
                         "\n\nRead these files if they are not relevant to your work, then you can stop. Otherwise, please consider whether you need to change your approach given this information."
            }))
            # Save state after blocking
            save_seen_files(get_agent_state_file(agent_name), new_nodes)
        else:
            # No new files, allow stopping
            print(json.dumps({
                "decision": "approve",
                "reason": "Session complete."
            }))
        sys.exit(0)

    # Default: no output
    sys.exit(0)

if __name__ == "__main__":
    main()