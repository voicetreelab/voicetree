#!/usr/bin/env python3
"""
End-to-End Test Lab for Agent Orchestration System
Tests the complete agent lifecycle from task initiation to output validation.
"""

import os
import sys
import json
import shutil
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime
import uuid
import time
import threading

class EndToEndTestLab:
    def __init__(self, voicetree_root=None):
        # Simple relative path from test_lab folder if not provided
        if voicetree_root is None:
            self.voicetree_root = Path("../../../..")
        else:
            self.voicetree_root = Path(voicetree_root)
        self.test_vault_root = None
        self.test_results = []
        self.current_test = None
        
    def setup_test_environment(self):
        """Create isolated test environment with temporary vault"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.test_vault_root = self.voicetree_root / f"test_vault_{timestamp}"
        self.test_vault_root.mkdir(exist_ok=True)
        
        # Create test date directory
        test_date_dir = self.test_vault_root / "2025-08-08"
        test_date_dir.mkdir(exist_ok=True)
        
        return test_date_dir
        
    def cleanup_test_environment(self):
        """Clean up test environment"""
        if self.test_vault_root and self.test_vault_root.exists():
            shutil.rmtree(self.test_vault_root)
            
    def create_dummy_source_note(self, test_dir, test_name, content):
        """Create a dummy source note for testing"""
        source_note = test_dir / f"1_{test_name.replace(' ', '_')}.md"
        
        source_content = f"""---
node_id: 1
title: {test_name} (1)
---
### Test Scenario: {test_name}

{content}

-----------------
_Links:_
Parent:
- root_test_node
"""
        
        with open(source_note, 'w') as f:
            f.write(source_content)
            
        return source_note
        
    def create_hook_injection_node(self, test_dir, injection_content, node_name="URGENT_INSTRUCTION_UPDATE"):
        """Create a hook injection node after agent has started"""
        # Generate a random node ID to prevent cheating
        import random
        node_id = random.randint(100, 999)
        injection_node = test_dir / f"{node_id}_{node_name}.md"
        
        injection_node_content = f"""---
node_id: {node_id}
title: {node_name} ({node_id})
color: blue
---
## User Feedback

{injection_content}

Timestamp: Added after your initial work started
Priority: Please incorporate this update into your current documentation

-----------------
_Links:_
Parent:
- root_test_node
"""
        
        with open(injection_node, 'w') as f:
            f.write(injection_node_content)
            
        return injection_node
        
    def run_headless_agent_test(self, source_note_path, test_prompt, expected_behaviors=None, hook_injection=None):
        """Run agent test using the actual VoiceTree agent system with optional hook injection"""
        test_id = str(uuid.uuid4())[:8]
        self.current_test = {
            'id': test_id,
            'source_note': str(source_note_path),
            'prompt': test_prompt,
            'expected_behaviors': expected_behaviors or [],
            'hook_injection': hook_injection,
            'start_time': datetime.now(),
            'status': 'running'
        }

        # Set up environment variables for the VoiceTree agent system using absolute paths
        env = os.environ.copy()

        # Get absolute paths to key directories
        current_file = Path(__file__).resolve()
        voicetree_root = current_file.parent.parent.parent.parent.parent  # Go up to VoiceTree root
        tools_dir = voicetree_root / "tools"

        # Use absolute paths for vault and source note
        env['OBSIDIAN_VAULT_PATH'] = str(self.test_vault_root.resolve())
        env['OBSIDIAN_SOURCE_NOTE'] = str(source_note_path.relative_to(self.test_vault_root))
        env['VOICETREE_ROOT'] = str(voicetree_root)
        env['TOOLS_DIR'] = str(tools_dir)
            
        # Set up hook injection if enabled
        injection_thread = None
        if hook_injection and hook_injection.get('enabled'):
            test_dir = source_note_path.parent
            delay = hook_injection.get('delay_seconds', 3)
            injection_content = hook_injection.get('injection_content')
            node_name = hook_injection.get('injection_node_name', 'URGENT_INSTRUCTION_UPDATE')
            
            def inject_hook():
                time.sleep(delay)
                print(f"[HOOK] Injecting instruction node after {delay} seconds...")
                injection_node = self.create_hook_injection_node(test_dir, injection_content, node_name)
                print(f"[HOOK] Created injection node: {injection_node}")
                
            injection_thread = threading.Thread(target=inject_hook)
            injection_thread.daemon = True
            
        try:
            # Use the actual VoiceTree agent system via claude.sh with absolute path
            claude_sh_path = tools_dir / "claude.sh"
            cmd = ['bash', str(claude_sh_path)]

            print(f"Running agent via VoiceTree system: {cmd}")
            print(f"  OBSIDIAN_VAULT_PATH: {env['OBSIDIAN_VAULT_PATH']}")
            print(f"  OBSIDIAN_SOURCE_NOTE: {env['OBSIDIAN_SOURCE_NOTE']}")

            # Start hook injection thread if configured
            if injection_thread:
                injection_thread.start()

            # Run with headless mode by adding --max-turns to limit execution
            result = subprocess.run(
                cmd,
                cwd=str(tools_dir),  # Run from tools directory using absolute path
                env=env,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute timeout
                input="exit\n"  # Send exit command to terminate after processing
            )
            
            self.current_test.update({
                'end_time': datetime.now(),
                'status': 'completed',
                'exit_code': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'execution_time': (datetime.now() - self.current_test['start_time']).total_seconds()
            })
            
            return result
            
        except subprocess.TimeoutExpired:
            self.current_test.update({
                'end_time': datetime.now(),
                'status': 'timeout',
                'error': 'Test timed out after 300 seconds'
            })
            return None
            
        except Exception as e:
            self.current_test.update({
                'end_time': datetime.now(),
                'status': 'error',
                'error': str(e)
            })
            return None
            
    def validate_test_output(self, test_dir, check_for_phrase=None):
        """Validate the output of a test run"""
        validations = {
            'new_nodes_created': False,
            'proper_node_ids': False,
            'agent_identity': False,  # Check for agent_name or color
            'parent_child_links': False,
            'yaml_frontmatter': False,
            'content_format': False
        }
        
        # Add phrase validation if requested
        if check_for_phrase:
            validations['contains_required_phrase'] = False
        
        # Check for new nodes created during test
        new_files = list(test_dir.glob("*.md"))
        
        # Find the source node (should be the one that doesn't have an underscore after the first digit)
        # OR it's a named source node like "1_test_scenario.md" 
        source_nodes = [f for f in new_files if f.stem.startswith('1') and not ('_' in f.stem[1:] and f.stem[1:].split('_')[0].isdigit())]
        child_nodes = [f for f in new_files if f.stem.startswith('1_') and '_' in f.stem[2:]]
        
        if len(child_nodes) > 0:  # Found child nodes created from source
            validations['new_nodes_created'] = True
            
            # Validate each child node
            for node_file in child_nodes:
                with open(node_file, 'r') as f:
                    content = f.read()
                    
                # Check YAML frontmatter
                if content.startswith('---') and 'node_id:' in content and 'title:' in content:
                    validations['yaml_frontmatter'] = True
                    
                # Check agent identity (agent_name or color)
                if 'agent_name:' in content or 'color:' in content:
                    validations['agent_identity'] = True
                    
                # Check parent-child links
                if '_Links:_' in content and 'Parent:' in content:
                    validations['parent_child_links'] = True
                    
                # Check proper node ID format (1_X pattern)
                if '_' in node_file.stem[2:]:  # Has underscore after "1_"
                    validations['proper_node_ids'] = True
                    
                # Check content format (has summary, technical details, etc.)
                if '## Summary' in content or '**Summary**' in content:
                    validations['content_format'] = True
                    
                # Check for required phrase if specified
                if check_for_phrase and check_for_phrase.upper() in content.upper():
                    validations['contains_required_phrase'] = True
        
        return validations
        
    def run_test_scenario(self, scenario_name, source_content, test_prompt, expected_behaviors=None, hook_injection=None, check_for_phrase=None):
        """Run a complete test scenario with optional hook injection"""
        print(f"\n=== Running Test Scenario: {scenario_name} ===")
        
        # Setup
        test_dir = self.setup_test_environment()
        # Combine source_content and test_prompt as the agent would receive it
        full_content = f"{source_content}\n\n### Task:\n{test_prompt}"
        source_note = self.create_dummy_source_note(test_dir, scenario_name, full_content)
        
        # Execute (no need to pass test_prompt separately since it's in the source note)
        result = self.run_headless_agent_test(source_note, "", expected_behaviors, hook_injection)
        
        if result is None:
            print(f"❌ Test failed to execute: {self.current_test.get('error', 'Unknown error')}")
            return False
            
        # Validate
        validations = self.validate_test_output(test_dir, check_for_phrase)
        
        # Update test results
        self.current_test['validations'] = validations
        self.test_results.append(self.current_test.copy())
        
        # Report
        passed_validations = sum(1 for v in validations.values() if v)
        total_validations = len(validations)
        
        print(f"Test Status: {self.current_test['status']}")
        print(f"Exit Code: {self.current_test['exit_code']}")
        print(f"Execution Time: {self.current_test['execution_time']:.2f}s")
        print(f"Validations Passed: {passed_validations}/{total_validations}")
        
        for validation, passed in validations.items():
            status = "✅" if passed else "❌"
            print(f"  {status} {validation}")
            
        if result.stdout:
            print(f"\nAgent Output:\n{result.stdout[:500]}...")
            
        if result.stderr:
            print(f"\nStderr:\n{result.stderr[:200]}...")
            
        # Calculate success before cleanup
        success = passed_validations >= total_validations * 0.7  # 70% pass rate

        # Always cleanup test environment unless DEBUG_TESTS env var is set
        debug_mode = os.environ.get('DEBUG_TESTS', 'false').lower() == 'true'
        if debug_mode and not success:
            print(f"❗ Test vault preserved for debugging: {self.test_vault_root}")
        else:
            self.cleanup_test_environment()
        print(f"Overall Result: {'✅ PASS' if success else '❌ FAIL'}")
        
        return success
        
    def generate_test_report(self, output_file=None):
        """Generate comprehensive test report"""
        if not output_file:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = self.voicetree_root / f"test_results_{timestamp}.json"
            
        report = {
            'test_run_timestamp': datetime.now().isoformat(),
            'total_tests': len(self.test_results),
            'passed_tests': len([t for t in self.test_results if t.get('validations', {})]),
            'test_results': self.test_results
        }
        
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2, default=str)
            
        print(f"\n📊 Test report generated: {output_file}")
        return output_file

def main():
    """Run the test lab"""
    lab = EndToEndTestLab()
    
    # Test Scenario 1: Simple Progress Node Creation
    success1 = lab.run_test_scenario(
        "Simple Progress Node Creation",
        "Test creating a simple progress node with proper formatting and linking.",
        """Create a progress node called "Task Analysis Complete" with the following content:
        
        ## Summary
        Completed analysis of the test task requirements and identified key components.
        
        ## Technical Details
        - Analyzed source requirements
        - Identified key components
        - Created implementation plan
        
        ## Architecture Diagram
        ```mermaid
        flowchart TD
            A[Requirements] --> B[Analysis]
            B --> C[Implementation Plan]
        ```
        
        ## Impact
        This analysis enables structured implementation of the test scenario.
        """,
        expected_behaviors=['create_progress_node', 'use_mermaid_diagram', 'proper_yaml']
    )
    
    # Test Scenario 2: Subtask Creation (Orchestration)
    success2 = lab.run_test_scenario(
        "Agent Subtask Creation",
        "Test agent creating subtasks for a complex orchestration scenario.",
        """You are an orchestrator agent. Create 2 subtasks for implementing a user dashboard:
        
        1. Create a subtask called "Frontend Dashboard Components" for implementing the UI
        2. Create a subtask called "Backend API Integration" for data connectivity
        
        Each subtask should have proper structure with Summary, Technical Details, Mermaid diagrams, and Impact sections.
        """,
        expected_behaviors=['create_multiple_subtasks', 'orchestration_behavior', 'structured_content']
    )
    
    # Generate report
    report_file = lab.generate_test_report()
    
    # Summary
    total_success = success1 and success2
    print(f"\n🎯 END-TO-END TEST LAB SUMMARY:")
    print(f"Total Scenarios: 2")
    print(f"Passed: {sum([success1, success2])}/2")
    print(f"Overall Status: {'✅ ALL TESTS PASSED' if total_success else '❌ SOME TESTS FAILED'}")
    
    return 0 if total_success else 1

if __name__ == "__main__":
    sys.exit(main())