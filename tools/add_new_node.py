#!/usr/bin/env python3
"""
Script to add a new node to the VoiceTree structure by creating a new markdown file
and linking it to its parent file.
"""

import os
import re
import sys
import argparse
from pathlib import Path


def addNewNode(parent_file, name, markdown_content, relationship_to, color_override=None, agent_name_override=None):
    """
    Add a new node to the VoiceTree structure.
    
    Args:
        parent_file (str): Path to the parent markdown file (relative to markdownTreeVault or absolute)
        name (str): Name/title of the new node
        markdown_content (str): Content for the new node's markdown file
        relationship_to (str): Relationship type to parent (e.g., "is_a_component_of", "is_a_feature_of")
        color_override (str, optional): Override color instead of using AGENT_COLOR env var
        agent_name_override (str, optional): Override agent name instead of using AGENT_NAME env var
    
    Returns:
        str: Path to the newly created file
    """
    # Use color override if provided, otherwise get from environment variable
    if color_override:
        color = color_override
    else:
        color = os.environ.get('AGENT_COLOR', 'blue')
    
    # Get agent name from override or environment
    if agent_name_override:
        agent_name = agent_name_override
    else:
        agent_name = os.environ.get('AGENT_NAME', 'default')
    
    # Get the base vault directory
    script_dir = Path(__file__).parent.parent  # Go up from tools/ to VoiceTree/
    vault_dir = script_dir / "markdownTreeVault"
    
    # Convert parent_file to Path and make it relative to vault if needed
    parent_path = Path(parent_file)
    
    # If parent_file is absolute and contains markdownTreeVault, make it relative
    if parent_path.is_absolute():
        if "markdownTreeVault" in str(parent_path):
            # Extract the path relative to markdownTreeVault
            parts = parent_path.parts
            vault_idx = parts.index("markdownTreeVault")
            parent_path = Path(*parts[vault_idx + 1:])
        else:
            # If absolute but not in vault, just use the filename
            parent_path = Path(parent_path.name)
    
    # Now parent_path is relative to vault, resolve it
    full_parent_path = vault_dir / parent_path
    
    # Get parent directory and parent filename
    parent_dir = full_parent_path.parent
    parent_filename = full_parent_path.name
    
    # Extract parent node ID from filename, or use a default
    parent_id_match = re.match(r'^(\d+(?:_\d+)*)', parent_filename)
    if parent_id_match:
        parent_id = parent_id_match.group(1)
    else:
        # If no ID in parent, use "1" as default parent ID
        parent_id = "1"
    
    # Find the next available child ID
    existing_children = []
    for file in parent_dir.glob(f"{parent_id}_*.md"):
        if file.name != parent_filename:
            child_match = re.match(rf'^{re.escape(parent_id)}_(\d+)', file.name)
            if child_match:
                existing_children.append(int(child_match.group(1)))
    
    next_child_num = max(existing_children, default=0) + 1
    new_node_id = f"{parent_id}_{next_child_num}"
    
    # Create safe filename from name
    safe_name = re.sub(r'[^\w\s-]', '', name)
    safe_name = re.sub(r'[-\s]+', '_', safe_name)
    
    # Always prepend agent_name to filename for agent-created nodes
    if agent_name and agent_name != 'default':
        new_filename = f"{new_node_id}_{agent_name}_{safe_name}.md"
    else:
        new_filename = f"{new_node_id}_{safe_name}.md"
    
    new_file_path = parent_dir / new_filename
    
    # Sanitize markdown content to prevent header rendering issues
    # Only escape headers at the beginning of lines
    lines = markdown_content.split('\n')
    sanitized_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('###'):
            sanitized_lines.append(line.replace('###', '**', 1) + '**')
        elif stripped.startswith('##'):
            sanitized_lines.append(line.replace('##', '**', 1) + '**')
        elif stripped.startswith('#'):
            sanitized_lines.append(line.replace('#', '**', 1) + '**')
        else:
            sanitized_lines.append(line)
    sanitized_content = '\n'.join(sanitized_lines)
    
    # Create the new node content with frontmatter
    # Include agent name in title if it's an agent-created node
    if agent_name and agent_name != 'default':
        title_with_agent = f"({agent_name}) {name} ({new_node_id})"
    else:
        title_with_agent = f"{name} ({new_node_id})"
    
    frontmatter_lines = [
        "---",
        f"node_id: {new_node_id}",
        f"title: {title_with_agent}",
        f"color: {color}"
    ]
    
    # Always add agent_name to frontmatter (defaults to 'default' if not set)
    frontmatter_lines.append(f"agent_name: {agent_name}")
    
    frontmatter_lines.append("---")
    
    # Calculate relative path from vault root for the parent link
    relative_parent_dir = parent_dir.relative_to(vault_dir)
    new_content = "\n".join(frontmatter_lines) + f"\n{sanitized_content}\n\n-----------------\n_Links:_\nParent:\n- {relationship_to} [[{relative_parent_dir}/{parent_filename}]]"
    
    # Write the new file
    with open(new_file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    # DO NOT ADD CHILD LINKS FOR NOW

    # # Update parent file to add child link
    # with open(parent_file, 'r', encoding='utf-8') as f:
    #     parent_content = f.read()
    #
    # # Check if parent already has a Children section
    # if '\nChildren:' in parent_content:
    #     # Add to existing children section
    #     lines = parent_content.split('\n')
    #     for i, line in enumerate(lines):
    #         if line.strip() == 'Children:':
    #             # Find the next non-child line
    #             j = i + 1
    #             while j < len(lines) and (lines[j].startswith('- ') or lines[j].strip() == ''):
    #                 j += 1
    #             # Insert new child link
    #             lines.insert(j, f"- [[{parent_dir.name}/{new_filename}]] {relationship_to} this")
    #             break
    #     parent_content = '\n'.join(lines)
    # else:
    #     # Add new children section before the last line
    #     lines = parent_content.rstrip().split('\n')
    #     if lines[-1].strip() == '':
    #         lines.pop()
    #     lines.append('\nChildren:')
    #     lines.append(f"- [[{parent_dir.name}/{new_filename}]] {relationship_to} this")
    #     lines.append('')
    #     parent_content = '\n'.join(lines)
    
    # # Write updated parent content
    # with open(parent_file, 'w', encoding='utf-8') as f:
    #     f.write(parent_content)
    
    print(f"Created new node: {new_file_path}")
    print(f"Updated parent: {full_parent_path}")
    
    return str(new_file_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Add a new node to the VoiceTree structure",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Regular agent use (color and name from env vars):
  python add_new_node.py parent.md "Task Manager" "Manages tasks" is_a_component_of
  
  # Orchestrator creating subtask with specific color and name:
  python add_new_node.py parent.md "Bob Subtask" "Implement feature X" is_subtask_of --color green --agent-name Bob
  
Note: Color/name taken from AGENT_COLOR/AGENT_NAME env vars unless overridden
        """
    )
    
    parser.add_argument("parent_file", help="Path to the parent markdown file")
    parser.add_argument("name", help="Name/title of the new node")
    parser.add_argument("markdown_content", help="Content for the new node's markdown file")
    parser.add_argument("relationship_to", help="Relationship type to parent (e.g., is_a_component_of, is_a_feature_of)")
    parser.add_argument("--color", dest="color_override", help="Override color (for orchestrator agents creating subtasks)")
    parser.add_argument("--agent-name", dest="agent_name_override", help="Override agent name (for orchestrator agents creating subtasks)")
    
    args = parser.parse_args()
    
    try:
        new_file = addNewNode(
            args.parent_file,
            args.name,
            args.markdown_content,
            args.relationship_to,
            args.color_override,
            args.agent_name_override
        )
        print(f"\nSuccess! New node created at: {new_file}")
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)