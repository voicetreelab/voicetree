#!/usr/bin/env python3
"""
Script to add a new node to the VoiceTree structure by creating a new markdown file
and linking it to its parent file.
"""

import argparse
import os
import re
import sys
from pathlib import Path


def addNewNode(parent_file=None, name=None, markdown_content=None, relationship_to=None, color_override=None, agent_name_override=None):
    """
    Add a new node to the VoiceTree structure.

    Args:
        parent_file (str, optional): Path to the parent markdown file (relative to vault or absolute).
                                     If not provided, uses CONTEXT_NODE_PATH env var.
        name (str): Name/title of the new node
        markdown_content (str): Content for the new node's markdown file
        relationship_to (str, optional): Relationship type to parent (e.g., "is_a_component_of", "is_a_feature_of").
                                         If not provided, creates a plain link without relationship label.
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

    # Get vault path from environment variable
    vault_path_env = os.environ.get('OBSIDIAN_VAULT_PATH')

    # If parent_file not provided, use CONTEXT_NODE_PATH from environment
    if parent_file is None:
        source_note = os.environ.get('CONTEXT_NODE_PATH')
        if not source_note or not vault_path_env:
            raise ValueError("parent_file not provided and OBSIDIAN_VAULT_PATH/CONTEXT_NODE_PATH not set")
        parent_file = source_note

    # Convert parent_file to Path
    parent_path = Path(parent_file)

    # Determine vault directory
    if parent_path.is_absolute():
        # Use the directory containing the parent file as the working directory
        full_parent_path = parent_path
        # Find vault directory by traversing up to find a directory containing .md files
        # or use parent's parent if it looks like a vault subdirectory
        vault_dir = parent_path.parent

    else:
        # Use OBSIDIAN_VAULT_PATH for relative paths
        if not vault_path_env:
            raise ValueError("OBSIDIAN_VAULT_PATH environment variable must be set for relative paths")
        vault_dir = Path(vault_path_env)
        full_parent_path = vault_dir / parent_path
    
    # Get parent directory and parent filename
    parent_dir = full_parent_path.parent
    parent_filename = full_parent_path.name

    # Find max node_id across all files in the vault
    max_node_id = 0
    for md_file in vault_dir.rglob("*.md"):
        # Read frontmatter to get node_id
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                # Extract node_id from frontmatter
                node_id_match = re.search(r'^node_id:\s*(\d+)', content, re.MULTILINE)
                if node_id_match:
                    node_id = int(node_id_match.group(1))
                    max_node_id = max(max_node_id, node_id)
        except Exception:
            # Skip files that can't be read
            continue

    # Use max_node_id + 1 for the new node
    new_node_id = str(max_node_id + 1)
    
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
    # todo don't know why the fuck we were doing this
    sanitized_content = markdown_content
    # sanitized_lines = []
    # for line in lines:
    #     stripped = line.strip()
    #     if stripped.startswith('###'):
    #         sanitized_lines.append(line.replace('###', '**', 1) + '**')
    #     elif stripped.startswith('##'):
    #         sanitized_lines.append(line.replace('##', '**', 1) + '**')
    #     elif stripped.startswith('#'):
    #         sanitized_lines.append(line.replace('#', '**', 1) + '**')
    #     else:
    #         sanitized_lines.append(line)
    # sanitized_content = '\n'.join(sanitized_lines)
    
    # Create the new node content with frontmatter
    # Include agent name in title if it's an agent-created node
    if agent_name and agent_name != 'default':
        title_with_agent = f"{agent_name}: {name}"
    else:
        title_with_agent = f"{name}"
    
    # Escape single quotes in title for YAML safety (double them)

    frontmatter_lines = [
        "---",
        f"node_id: {new_node_id}",
        f"color: {color}"
    ]
    
    # Always add agent_name to frontmatter (defaults to 'default' if not set)
    frontmatter_lines.append(f"agent_name: {agent_name}")
    
    frontmatter_lines.append("---")
    frontmatter_lines.append(f"# {title_with_agent}")
    
    # Calculate relative path from vault root for the parent link
    relative_parent_dir = parent_dir.relative_to(vault_dir)
    parent_link = f"[[{relative_parent_dir}/{parent_filename}]]"
    if relationship_to:
        parent_link = f"{relationship_to} {parent_link}"
    new_content = "\n".join(frontmatter_lines) + f"\n{sanitized_content}\n\n-----------------\n_Links:_\nParent:\n- {parent_link}"
    
    # Write the new file
    with open(new_file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    # Mark this file as seen by the current agent to prevent hook notifications
    try:
        sys.path.insert(0, str(Path(__file__).parent / "hooks"))
        from tree_update_reminder import mark_file_as_seen_by_agent
        mark_file_as_seen_by_agent(str(vault_dir), str(new_file_path), agent_name)
    except ImportError:
        # Hook module not available, silently continue
        pass

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
    
    absolute_path = str(new_file_path.resolve())
    print(f"Created new node at: {absolute_path}")

    return absolute_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Add a new node to the VoiceTree structure",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Plain link (no relationship):
  python3 add_new_node.py "Task Manager" "Manages tasks"

  # With relationship type:
  python3 add_new_node.py "Task Manager" "Manages tasks" is_a_component_of

  # With explicit parent file:
  python3 add_new_node.py "Task Manager" "Manages tasks" is_a_component_of --parent parent.md

  # Orchestrator creating subtask with specific color and name:
  python3 add_new_node.py "Bob Subtask" "Implement feature X" is_subtask_of --parent parent.md --color green --agent-name Bob

Note: Color/name taken from AGENT_COLOR/AGENT_NAME env vars unless overridden.
      Vault path from OBSIDIAN_VAULT_PATH, parent defaults to CONTEXT_NODE_PATH.
        """
    )

    parser.add_argument("name", help="Name/title of the new node")
    parser.add_argument("markdown_content", help="Content for the new node's markdown file")
    # TODO: consider using quoted strings with spaces for relationships (e.g., "is progress of") for more natural markdown output
    parser.add_argument("relationship_to", nargs='?', default=None, help="Relationship type to parent (e.g., is_a_component_of). Optional - omit for plain link.")
    parser.add_argument("--parent", dest="parent_file", help="Path to the parent markdown file (defaults to CONTEXT_NODE_PATH)")
    parser.add_argument("--color", dest="color_override", help="Override color (for orchestrator agents creating subtasks)")
    parser.add_argument("--agent-name", dest="agent_name_override", help="Override agent name (for orchestrator agents creating subtasks)")

    args = parser.parse_args()

    try:
        addNewNode(
            args.parent_file,
            args.name,
            args.markdown_content,
            args.relationship_to,
            args.color_override,
            args.agent_name_override
        )
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)