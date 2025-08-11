#!/usr/bin/env python3
"""
Generate agent launch scripts from templates.

Usage:
    python generate_agent_script.py --agent-name BOB --color green --task-file AGENT_BOB.md
"""

import argparse
import os
from pathlib import Path
from typing import Dict, Optional


PROMPT_TEMPLATE = """You are engineer {agent_name}, helping with a focused task within the VoiceTree system.

Your task:
A single node in a task/decision tree, located at {task_path}
Contents of {task_file}:
$(cat {task_path})

IMPORTANT INSTRUCTIONS:
We have shared markdown vault: {markdown_vault}

As you are building out the solution to your task, at every stage you should also be updating the markdown tree, adding new files connected to {task_path} to show your progress. Keep these new notes extremely concise.

Also keep the checkboxes in your main task file up to date as you progress.

**Instructions for agents**:
- Add color to YAML frontmatter of all markdown files you create
- Use your assigned color ({color}) consistently
- This enables visual progress tracking in Obsidian/markdown viewers

e.g.
---
color: {color}
---

When creating additional files connected to your source task, extending the markdown tree, ensure the new files are connected by markdown links
e.g. `[[{task_file_stem}]]`
For each of these new files, ensure the yaml front matter has `color: {color}`

Okay excellent. Here are the first four steps you should do:
1. read your subtask markdown file (already included above)
2. understand where it fits into the wider context of the overall task (read the linked parent files)
3. think hard about the minimally complex way to implement this, do not add any extra unnecessary complexity. Fail hard and fast. Don't have fallbacks, don't have multiple options. Don't write too many tests, just a single test for the input/output behaviour of the component you are testing.
4. Write the behavioural test, now follow TDD to execute your subtask!"""


SCRIPT_TEMPLATE = """#!/bin/bash
# {agent_name_lower}.sh - Launch {agent_name} agent for {description}

set -e  # Exit on error

# Simple relative paths from tools folder
MARKDOWN_VAULT="../agent-communication/{vault_subdir}"

echo "🚀 Starting {agent_name} agent for {description}..."

{agent_name_upper}_PROMPT="{escaped_prompt}"

# Launch {agent_name}
echo "🤖 Launching {agent_name} agent..."
cd ..

# Use --dangerously-skip-permissions to avoid file access prompts
# Increase max-turns for complex implementation
claude "${agent_name_upper}_PROMPT" --dangerously-skip-permissions  --model {model}

echo "✅ {agent_name} agent completed!"
"""


def generate_agent_script(
    agent_name: str,
    color: str,
    task_file: str,
    vault_subdir: str = "clustering_task",
    description: Optional[str] = None,
    max_turns: int = 30,
    model: str = "sonnet",
    output_dir: Optional[str] = None
) -> str:
    """Generate an agent launch script from parameters."""
    
    # Derive values
    agent_name_upper = agent_name.upper()
    agent_name_lower = agent_name.lower()
    task_file_stem = Path(task_file).stem
    
    if description is None:
        description = f"{task_file_stem} implementation"
    
    # Build paths using simple relative paths from tools folder
    markdown_vault = f"../agent-communication/{vault_subdir}"
    task_path = f"{markdown_vault}/{task_file}"
    
    # Format prompt
    prompt = PROMPT_TEMPLATE.format(
        agent_name=agent_name,
        task_path=task_path,
        task_file=task_file,
        markdown_vault=markdown_vault,
        color=color,
        task_file_stem=task_file_stem
    )
    
    # Escape prompt for bash (escape double quotes, dollar signs, and backticks)
    escaped_prompt = prompt.replace('"', '\\"').replace('$', '\\$').replace('`', '\\`')
    
    # Generate script
    script_content = SCRIPT_TEMPLATE.format(
        agent_name=agent_name,
        agent_name_upper=agent_name_upper,
        agent_name_lower=agent_name_lower,
        description=description,
        vault_subdir=vault_subdir,
        escaped_prompt=escaped_prompt,
        max_turns=max_turns,
        model=model
    )
    
    # Write script
    if output_dir is None:
        # Use OBSIDIAN_VAULT_PATH if available, otherwise current directory
        output_dir = os.environ.get('OBSIDIAN_VAULT_PATH', '.')
    
    output_path = Path(output_dir) / f"{agent_name_lower}.sh"
    output_path.write_text(script_content)
    
    # Make executable
    os.chmod(output_path, 0o755)
    
    return str(output_path)


def main():
    parser = argparse.ArgumentParser(description="Generate agent launch scripts")
    parser.add_argument("--agent-name", required=True, help="Agent name (e.g., BOB)")
    parser.add_argument("--color", required=True, help="Agent color for markdown files")
    parser.add_argument("--task-file", required=True, help="Task markdown file name")
    parser.add_argument("--vault-subdir", default="clustering_task", help="Subdirectory in agent-communication")
    parser.add_argument("--description", help="Task description (auto-generated if not provided)")
    parser.add_argument("--max-turns", type=int, default=30, help="Max turns for Claude")
    parser.add_argument("--model", default="sonnet", help="Model to use (sonnet/opus)")
    parser.add_argument("--output-dir", help="Output directory for script (defaults to $OBSIDIAN_VAULT_PATH if set)")
    
    args = parser.parse_args()
    
    script_path = generate_agent_script(
        agent_name=args.agent_name,
        color=args.color,
        task_file=args.task_file,
        vault_subdir=args.vault_subdir,
        description=args.description,
        max_turns=args.max_turns,
        model=args.model,
        output_dir=args.output_dir
    )
    
    print(f"✅ Generated script: {script_path}")
    print(f"   Agent: {args.agent_name}")
    print(f"   Color: {args.color}")
    print(f"   Task: {args.task_file}")
    print(f"   Model: {args.model}")
    print(f"\nRun with: ./{os.path.basename(script_path)}")


if __name__ == "__main__":
    main()