#!/usr/bin/env python3
"""
Claude Headless Wrapper for Agent Testing
Wraps claude command execution with proper environment setup for headless testing.
"""

import os
import sys
import subprocess
from pathlib import Path
import tempfile

class ClaudeHeadlessWrapper:
    def __init__(self, voicetree_root=None):
        # Simple relative path from test_lab folder if not provided
        if voicetree_root is None:
            self.voicetree_root = Path("../../../..")
        else:
            self.voicetree_root = Path(voicetree_root)
        self.common_setup_script = self.voicetree_root / "tools/common_agent_setup.sh"
        
    def run_headless_agent(self, source_note_path, agent_prompt, vault_path, agent_color="test_blue", timeout=120):
        """
        Run a claude agent headlessly with proper environment setup
        
        Args:
            source_note_path: Path to the source markdown note (relative to vault)
            agent_prompt: The prompt to send to the agent
            vault_path: Path to the obsidian vault
            agent_color: Color to assign to the agent
            timeout: Timeout in seconds
            
        Returns:
            subprocess.CompletedProcess result
        """
        
        # Setup environment variables (mimicking common_agent_setup.sh)
        env = os.environ.copy()
        env.update({
            'OBSIDIAN_VAULT_PATH': str(vault_path),
            'OBSIDIAN_SOURCE_NOTE': str(source_note_path),
            'AGENT_COLOR': agent_color,
            'OBSIDIAN_SOURCE_NOTE_CONTENT': self._read_source_note_content(vault_path / source_note_path),
            'DEPENDENCY_GRAPH_CONTENT': self._generate_dependency_graph_content(vault_path, source_note_path)
        })
        
        # Create temporary prompt file with full agent context
        full_prompt = self._create_full_agent_prompt(agent_prompt, env)
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as prompt_file:
            prompt_file.write(full_prompt)
            prompt_file_path = prompt_file.name
            
        try:
            # Run claude with the prompt file
            cmd = [
                'claude',
                '--model', 'sonnet', 
                '--settings', str(self.voicetree_root / '.claude/settings.json'),
                '-p', prompt_file_path
            ]
            
            result = subprocess.run(
                cmd,
                cwd=str(self.voicetree_root),
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            return result
            
        finally:
            # Clean up temporary file
            os.unlink(prompt_file_path)
            
    def _read_source_note_content(self, source_note_full_path):
        """Read source note content"""
        try:
            if Path(source_note_full_path).exists():
                with open(source_note_full_path, 'r') as f:
                    return f.read()
            return "[Source note content unavailable]"
        except Exception:
            return "[Error reading source note]"
            
    def _generate_dependency_graph_content(self, vault_path, source_note_path):
        """Generate dependency graph content (simplified for testing)"""
        # For testing, we'll use a simple mock dependency graph
        # In production this would call graph_dependency_traversal_and_accumulate_graph_content.py
        return f"""====================
BRANCH 1: Starting from {source_note_path}
====================

------------------------------------------------------------
File: {source_note_path}
------------------------------------------------------------
{self._read_source_note_content(vault_path / source_note_path)}

====================
RELEVANT NODES (Test Environment)
====================
This is a test environment with minimal dependency context.
"""
        
    def _create_full_agent_prompt(self, agent_prompt, env):
        """Create full agent prompt with environment context"""
        return f"""You are engineer "{env.get('AGENT_COLOR', 'test')}"
You have AGENT_COLOR={env.get('AGENT_COLOR', 'test')}

The task will be given after these initial instructions.

As you make progress on the task, create detailed visual updates by adding nodes to our markdown tree using:

```bash
python tools/add_new_node.py "{env.get('OBSIDIAN_VAULT_PATH')}/{env.get('OBSIDIAN_SOURCE_NOTE')}" "Progress Name" "What you accomplished with detailed technical context and visual diagram" is_progress_of
```

## ENHANCED NODE CONTENT REQUIREMENTS:

When creating nodes, your content MUST include:

1. **Summary**: Brief description of what was accomplished
2. **Technical Details**: Specific changes, files modified, functions created, etc.
3. **Mermaid Diagram**: Visual representation of the change/architecture/flow
4. **Impact**: How this affects the overall system

### Content Format Template:
```markdown
## Summary
[Brief description of what was accomplished]

## Technical Details  
- **Files Modified**: List of files changed
- **Key Changes**: Specific modifications made
- **Methods/Functions**: New or modified code components

## Architecture/Flow Diagram
```mermaid
[Include relevant diagram type:
- flowchart: for process flows
- graph: for relationships  
- sequenceDiagram: for interactions
- classDiagram: for code structure
- gitGraph: for version changes]
```

## Impact
[How this change affects the overall system, dependencies, or workflow]
```

This tool will automatically:
- Use your color ({env.get('AGENT_COLOR', 'test')}) 
- Create proper node IDs and filenames
- Add correct YAML frontmatter
- Create parent-child links

IMPORTANT: DO NOT manually write markdown files. ALWAYS use add_new_node.py with rich, detailed content including Mermaid diagrams.

## RELEVANT CONTEXT 

The following content shows what other context may be related to your current file, it is a dependency traversal from 
the source note, plus any other potentially relevant files from a TF-IDF search:

=== RELEVANT_CONTEXT ===
{env.get('DEPENDENCY_GRAPH_CONTENT', '[No dependency context available]')}
=== END RELEVANT_CONTEXT ===

The source markdown file you've been opened from is {env.get('OBSIDIAN_SOURCE_NOTE')} in {env.get('OBSIDIAN_VAULT_PATH')}: @{env.get('OBSIDIAN_VAULT_PATH')}/{env.get('OBSIDIAN_SOURCE_NOTE')}

The CWD you are in is the repos directory (parent of VoiceTree)
This allows you to access the following repos:
- ./VoiceTree for the voicetree backend.
- ./voicetree-UI/juggl-main for juggl UI

As you complete any actions, REMEMBER to grow the tree by using:
python tools/add_new_node.py <parent_file> "Node Name" "Rich Content with Summary, Technical Details, Mermaid Diagram, and Impact" <relationship>

ALWAYS include Mermaid diagrams showing the changes you made!

To emphasize, YOUR specific task, or most relevant context (i.e. the source note you were spawned from) is:
```{env.get('OBSIDIAN_VAULT_PATH')}/{env.get('OBSIDIAN_SOURCE_NOTE')}
{env.get('OBSIDIAN_SOURCE_NOTE_CONTENT', '[Source content unavailable]')}
```

## YOUR SPECIFIC TASK:

{agent_prompt}

Please execute this task now.
"""

def main():
    """CLI interface for headless wrapper"""
    if len(sys.argv) < 4:
        print("Usage: python claude_headless_wrapper.py <vault_path> <source_note_relative_path> <prompt>")
        sys.exit(1)
        
    vault_path = Path(sys.argv[1])
    source_note_path = sys.argv[2]
    prompt = sys.argv[3]
    
    wrapper = ClaudeHeadlessWrapper()
    result = wrapper.run_headless_agent(source_note_path, prompt, vault_path)
    
    print("=== STDOUT ===")
    print(result.stdout)
    print("\n=== STDERR ===")
    print(result.stderr)
    print(f"\n=== EXIT CODE: {result.returncode} ===")
    
    return result.returncode

if __name__ == "__main__":
    sys.exit(main())