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


def addNewNode(parent_file=None, parent_files=None, name=None, markdown_content=None, relationship_to=None, color_override=None, agent_name_override=None):
    """
    Add a new node to the VoiceTree structure.

    Args:
        parent_file (str, optional): Path to a single parent markdown file (relative to vault or absolute).
                                     If not provided, uses CONTEXT_NODE_PATH env var.
        parent_files (list, optional): List of paths for multiple parents (for diamond dependencies).
                                       Takes precedence over parent_file if provided.
        name (str): Name/title of the new node
        markdown_content (str): Content for the new node's markdown file
        relationship_to (str, optional): Relationship type to parent (e.g., "is_a_component_of", "is_a_feature_of").
                                         If not provided, creates a plain link without relationship label.
        color_override (str, optional): Override color instead of using AGENT_COLOR env var
        agent_name_override (str, optional): Override agent name instead of using AGENT_NAME env var

    Returns:
        str: Path to the newly created file
    """
    if color_override:
        color = color_override
    else:
        color = os.environ.get('AGENT_COLOR', 'blue')
    
    # Get agent name from override or environment
    # Note: check `is not None` so empty string "" can override to no agent name
    if agent_name_override is not None:
        agent_name = agent_name_override
    else:
        agent_name = os.environ.get('AGENT_NAME', 'default')

    # Get vault path from environment variable
    vault_path_env = os.environ.get('OBSIDIAN_VAULT_PATH')

    # Handle multiple parents (for diamond dependencies) or single parent
    if parent_files:
        # Use first parent for directory placement, all parents for links
        all_parent_files = parent_files
        parent_file = parent_files[0]  # Use first parent for file placement
    elif parent_file is None:
        # If parent_file not provided, use CONTEXT_NODE_PATH from environment
        source_note = os.environ.get('CONTEXT_NODE_PATH')
        if not source_note or not vault_path_env:
            raise ValueError("parent_file not provided and OBSIDIAN_VAULT_PATH/CONTEXT_NODE_PATH not set")
        parent_file = source_note
        all_parent_files = [parent_file]
    else:
        all_parent_files = [parent_file]

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
        # For relative paths, try WATCHED_FOLDER first (default), fallback to OBSIDIAN_VAULT_PATH
        watched_folder_env = os.environ.get('WATCHED_FOLDER')

        # Default approach: WATCHED_FOLDER + parent_path directly
        if watched_folder_env:
            watched_folder = Path(watched_folder_env)
            full_parent_path = watched_folder / parent_path

            # If this path exists, use watched_folder as vault_dir
            if full_parent_path.exists():
                vault_dir = watched_folder
            # Fallback: try OBSIDIAN_VAULT_PATH with strip-prefix logic
            elif vault_path_env:
                vault_dir = Path(vault_path_env)
                adjusted_path = parent_path
                vault_name = vault_dir.name
                if adjusted_path.parts and adjusted_path.parts[0] == vault_name:
                    adjusted_path = Path(*adjusted_path.parts[1:])
                full_parent_path = vault_dir / adjusted_path
            else:
                # Keep the WATCHED_FOLDER path even if it doesn't exist (will fail later with clear error)
                vault_dir = watched_folder
        elif vault_path_env:
            # Legacy fallback: use OBSIDIAN_VAULT_PATH with strip-prefix logic
            vault_dir = Path(vault_path_env)
            vault_name = vault_dir.name
            if parent_path.parts and parent_path.parts[0] == vault_name:
                parent_path = Path(*parent_path.parts[1:])
            full_parent_path = vault_dir / parent_path
        else:
            raise ValueError("WATCHED_FOLDER or OBSIDIAN_VAULT_PATH environment variable must be set for relative paths")
    
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
    
    sanitized_content = markdown_content

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
    
    # Generate parent links for all parents
    parent_links = []
    for pf in all_parent_files:
        pf_path = Path(pf)

        # Resolve the parent file path to absolute if needed
        if pf_path.is_absolute():
            full_pf_path = pf_path
        else:
            # Try WATCHED_FOLDER first, then OBSIDIAN_VAULT_PATH
            watched_folder_env = os.environ.get('WATCHED_FOLDER')
            if watched_folder_env:
                full_pf_path = Path(watched_folder_env) / pf_path
                if not full_pf_path.exists() and vault_path_env:
                    # Fallback to vault path with strip-prefix
                    adjusted = pf_path
                    vault_name = Path(vault_path_env).name
                    if adjusted.parts and adjusted.parts[0] == vault_name:
                        adjusted = Path(*adjusted.parts[1:])
                    full_pf_path = Path(vault_path_env) / adjusted
            elif vault_path_env:
                adjusted = pf_path
                vault_name = Path(vault_path_env).name
                if adjusted.parts and adjusted.parts[0] == vault_name:
                    adjusted = Path(*adjusted.parts[1:])
                full_pf_path = Path(vault_path_env) / adjusted
            else:
                full_pf_path = pf_path  # Best effort

        # Calculate relative path from vault root
        try:
            relative_pf_path = full_pf_path.relative_to(vault_dir)
        except ValueError:
            # If can't make relative, use the filename
            relative_pf_path = full_pf_path.name

        link = f"[[{relative_pf_path}]]"
        if relationship_to:
            link = f"{relationship_to} {link}"
        parent_links.append(f"- {link}")

    # Format links section - use "Parents:" if multiple, "Parent:" if single
    links_header = "Parents:" if len(parent_links) > 1 else "Parent:"
    links_section = "\n".join(parent_links)
    new_content = "\n".join(frontmatter_lines) + f"\n{sanitized_content}\n\n-----------------\n_Links:_\n{links_header}\n{links_section}"
    
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
  python3 add_new_node.py "Task Manager" "### Manages tasks"

  # With relationship type:
  python3 add_new_node.py "Task Manager" "Manages tasks" --relationship is_a_component_of

  # With explicit parent file:
  python3 add_new_node.py "Task Manager" "Manages tasks" --parent parent.md

  # Multiple parents (diamond dependency):
  python3 add_new_node.py "Phase 4" "Needs both phases" --parents "phase2.md,phase3.md"

  # Orchestrator creating subtask with specific color and name:
  python3 add_new_node.py "Bob Subtask" "Implement feature X" --parent parent.md --color green --agent-name Bob

Note: Color/name taken from AGENT_COLOR/AGENT_NAME env vars unless overridden.
      Vault path from OBSIDIAN_VAULT_PATH, parent defaults to CONTEXT_NODE_PATH.
      Use --parent for single parent, --parents for multiple (comma-separated).
        """
    )

    parser.add_argument("name", help="Name/title of the new node")
    parser.add_argument("markdown_content", help="Content for the new node's markdown file")
    parser.add_argument("--relationship", dest="relationship_to", default=None, help="Relationship type to parent (e.g., is_a_component_of). Optional - omit for plain link.")
    parser.add_argument("--parent", dest="parent_file", help="Path to single parent markdown file (defaults to CONTEXT_NODE_PATH)")
    parser.add_argument("--parents", dest="parent_files_str", help="Comma-separated paths for multiple parents (diamond dependencies)")
    parser.add_argument("--color", dest="color_override", help="Override color (for orchestrator agents creating subtasks)")
    parser.add_argument("--agent-name", dest="agent_name_override", help="Override agent name (for orchestrator agents creating subtasks)")

    args = parser.parse_args()

    # Parse comma-separated parents if provided
    parent_files = None
    if args.parent_files_str:
        parent_files = [p.strip() for p in args.parent_files_str.split(',') if p.strip()]

    try:
        addNewNode(
            parent_file=args.parent_file,
            parent_files=parent_files,
            name=args.name,
            markdown_content=args.markdown_content,
            relationship_to=args.relationship_to,
            color_override=args.color_override,
            agent_name_override=args.agent_name_override
        )
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)