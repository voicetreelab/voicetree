# VoiceTree Test Lab Examples

This document provides practical examples and usage scenarios for the VoiceTree End-to-End Test Lab system.

## Basic Usage Examples

### Example 1: Running All Tests

```bash
cd /Users/bobbobby/repos/VoiceTree/tools/test_lab
python run_tests.py
```

**Expected Output:**
```
🧪 Running 5 test scenarios...

--- Test 1/5 ---
=== Running Test Scenario: Simple Progress Node Creation ===
Test Status: completed
Exit Code: 0
Execution Time: 23.45s
Validations Passed: 6/6
  ✅ new_nodes_created
  ✅ proper_node_ids
  ✅ color_consistency
  ✅ parent_child_links
  ✅ yaml_frontmatter
  ✅ content_format
Overall Result: ✅ PASS

--- Test 2/5 ---
=== Running Test Scenario: Agent Subtask Creation ===
...

============================================================
🎯 END-TO-END TEST LAB SUMMARY
============================================================
Total Scenarios: 5
Passed: 5
Failed: 0
Pass Rate: 100.0%
Report: /Users/bobbobby/repos/VoiceTree/test_results_20250808_143022.json
✅ TEST SUITE PASSED
```

### Example 2: Running a Specific Test

```bash
python run_tests.py --scenario "Simple Progress Node Creation"
```

**Expected Output:**
```
🧪 Running single test scenario: Simple Progress Node Creation

=== Running Test Scenario: Simple Progress Node Creation ===
Running headless test: ['claude', '--model', 'sonnet', '--settings', ...]
Test Status: completed
Exit Code: 0
Execution Time: 18.32s
Validations Passed: 6/6

Agent Output:
I'll create a progress node called "Task Analysis Complete" with the specified content...

============================================================
🎯 END-TO-END TEST LAB SUMMARY  
============================================================
Total Scenarios: 1
Passed: 1
Failed: 0
Pass Rate: 100.0%
✅ TEST SUITE PASSED
```

### Example 3: Listing Available Scenarios

```bash
python run_tests.py --list
```

**Expected Output:**
```
Available test scenarios:
1. Simple Progress Node Creation
   Description: Test basic agent functionality - creating a single progress node with proper structure
2. Agent Subtask Creation
   Description: Test orchestration agent creating multiple subtasks
3. Error Handling Test
   Description: Test agent behavior when encountering errors or edge cases
4. Cross-Agent Communication Test
   Description: Test multiple agents working on related tasks
5. Complex Technical Documentation
   Description: Test agent creating detailed technical documentation with multiple diagrams
```

## Advanced Usage Examples

### Example 4: Using Custom Configuration

Create a custom test file `my_tests.json`:
```json
{
  "test_scenarios": [
    {
      "name": "Custom Documentation Test",
      "description": "Test creating API documentation",
      "source_content": "Create comprehensive API documentation for the user management system.",
      "agent_prompt": "Create a documentation node called 'User API Documentation' that includes:\n\n## Summary\nComprehensive API documentation for user management endpoints.\n\n## Technical Details\n- Authentication requirements\n- Endpoint specifications\n- Request/response formats\n\n## API Flow Diagram\n```mermaid\nsequenceDiagram\n    participant Client\n    participant API\n    participant Database\n    \n    Client->>API: POST /users\n    API->>Database: Create user\n    Database-->>API: User created\n    API-->>Client: 201 Created\n```\n\n## Impact\nEnables developers to integrate with the user management API efficiently.",
      "expected_behaviors": ["create_progress_node", "api_documentation", "sequence_diagram"],
      "validation_criteria": {
        "new_nodes_created": true,
        "proper_node_ids": true,
        "mermaid_diagrams": true,
        "sequence_diagram_present": true
      }
    }
  ],
  "test_configuration": {
    "timeout_seconds": 180,
    "pass_threshold": 0.8
  }
}
```

Run with custom configuration:
```bash
python run_tests.py --config my_tests.json
```

### Example 5: Programmatic Usage

```python
#!/usr/bin/env python3
"""
Custom test runner example
"""

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent))

from end_to_end_test_runner import EndToEndTestLab

def run_custom_test():
    """Run a custom test scenario programmatically"""
    
    lab = EndToEndTestLab()
    
    # Define custom test scenario
    scenario_name = "Custom Integration Test"
    source_content = "Test scenario for custom integration validation."
    agent_prompt = """
    Create a progress node called "Integration Test Complete" that demonstrates:
    
    ## Summary
    Successfully validated the integration between frontend and backend components.
    
    ## Technical Details
    - Tested API endpoint connectivity
    - Validated data flow between components
    - Verified error handling mechanisms
    
    ## Integration Flow
    ```mermaid
    flowchart TD
        A[Frontend] --> B[API Gateway]
        B --> C[Backend Service]
        C --> D[Database]
        D --> C
        C --> B
        B --> A
    ```
    
    ## Impact
    Ensures reliable communication between system components.
    """
    
    expected_behaviors = [
        "create_progress_node",
        "integration_testing",
        "flowchart_diagram"
    ]
    
    # Run the test
    print("Running custom integration test...")
    success = lab.run_test_scenario(
        scenario_name,
        source_content, 
        agent_prompt,
        expected_behaviors
    )
    
    # Generate report
    report_file = lab.generate_test_report()
    print(f"Test report generated: {report_file}")
    
    return success

if __name__ == "__main__":
    success = run_custom_test()
    print(f"Test result: {'PASSED' if success else 'FAILED'}")
    sys.exit(0 if success else 1)
```

## Validation Examples

### Example 6: Understanding Validation Results

When a test runs, you'll see detailed validation output:

```
Validations Passed: 6/8
  ✅ new_nodes_created
  ✅ proper_node_ids  
  ✅ color_consistency
  ❌ parent_child_links
  ✅ yaml_frontmatter
  ✅ content_format
  ✅ mermaid_diagrams
  ❌ sanitized_filenames

Agent Output:
I'll create a progress node with the specified content. Let me use the add_new_node.py tool...

[tool call output truncated]

Stderr:
Warning: File name contains invalid characters, sanitizing...
```

**Interpretation:**
- 6 out of 8 validations passed (75% pass rate)
- The test would pass with default 70% threshold
- Missing parent-child links and filename sanitization issues
- Agent successfully created nodes with proper structure

### Example 7: Examining Test Reports

Generated test report (`test_results_20250808_143022.json`):

```json
{
  "test_run_timestamp": "2025-08-08T14:30:22.123456",
  "total_tests": 3,
  "passed_tests": 2,
  "test_results": [
    {
      "id": "abc12345",
      "source_note": "/tmp/test_vault_20250808_143022/2025-08-08/1_Simple_Progress_Node_Creation.md",
      "prompt": "Create a progress node called 'Task Analysis Complete'...",
      "expected_behaviors": ["create_progress_node", "use_mermaid_diagram"],
      "start_time": "2025-08-08T14:30:25.000000",
      "end_time": "2025-08-08T14:30:48.000000", 
      "status": "completed",
      "exit_code": 0,
      "execution_time": 23.45,
      "validations": {
        "new_nodes_created": true,
        "proper_node_ids": true,
        "color_consistency": true,
        "parent_child_links": true,
        "yaml_frontmatter": true,
        "content_format": true,
        "mermaid_diagrams": true,
        "sanitized_filenames": true
      }
    }
  ]
}
```

## Debugging Examples

### Example 8: Debugging Failed Tests

When tests fail, examine the detailed output:

```bash
python run_tests.py --scenario "Error Handling Test" --verbose
```

**Output with debugging info:**
```
=== Running Test Scenario: Error Handling Test ===
Running headless test: ['claude', '--model', 'sonnet', '--settings', '/Users/bobbobby/repos/VoiceTree/.claude/settings.json', '-p', '/tmp/test_prompt_def67890.md']
Test Status: completed
Exit Code: 0
Execution Time: 34.21s
Validations Passed: 4/6
  ✅ new_nodes_created
  ✅ proper_node_ids
  ❌ color_consistency
  ✅ parent_child_links
  ❌ yaml_frontmatter
  ✅ content_format

Agent Output:
I understand you want me to create a node with invalid characters. Let me handle this gracefully...

I'll sanitize the filename and create a properly formatted node instead...

python tools/add_new_node.py "/tmp/test_vault_20250808/2025-08-08/1_Error_Handling_Test.md" "Test Node With Invalid Characters" "..."

Created node: 1_2_Test_Node_With_Invalid_Characters.md

Stderr:
Warning: Color not properly set in environment
Warning: YAML frontmatter incomplete

Overall Result: ❌ FAIL
```

**Debugging Steps:**
1. Check agent output for error patterns
2. Verify environment variables are set correctly
3. Examine the created files manually (disable cleanup)
4. Review validation criteria for the specific test

### Example 9: Custom Validation

Create custom validation for specific requirements:

```python
#!/usr/bin/env python3
"""
Custom validation example
"""

from output_validator import AgentOutputValidator
from pathlib import Path
import re

class APIDocumentationValidator(AgentOutputValidator):
    def validate_api_documentation(self, content):
        """Custom validation for API documentation"""
        validations = {
            'has_endpoints': False,
            'has_examples': False,
            'has_authentication': False,
            'has_error_codes': False
        }
        
        # Check for API endpoints
        if re.search(r'(GET|POST|PUT|DELETE)\s+/', content):
            validations['has_endpoints'] = True
            
        # Check for code examples
        if re.search(r'```(json|curl|javascript)', content, re.IGNORECASE):
            validations['has_examples'] = True
            
        # Check for authentication section
        if re.search(r'auth(entication|orization)', content, re.IGNORECASE):
            validations['has_authentication'] = True
            
        # Check for error codes
        if re.search(r'(400|401|403|404|500)', content):
            validations['has_error_codes'] = True
            
        return validations

# Usage
validator = APIDocumentationValidator()
results = validator.validate_directory_output(Path("/tmp/test_output"))

# Add custom validation
for detail in results['details']:
    file_path = Path("/tmp/test_output") / detail['file']
    with open(file_path, 'r') as f:
        content = f.read()
    
    api_validations = validator.validate_api_documentation(content)
    detail['api_validations'] = api_validations
    
    print(f"API Documentation Validation for {detail['file']}:")
    for validation, passed in api_validations.items():
        status = "✅" if passed else "❌"
        print(f"  {status} {validation.replace('_', ' ').title()}")
```

## Error Scenarios and Solutions

### Example 10: Common Error Patterns

#### Agent Timeout
```
Test Status: timeout
error: Test timed out after 120 seconds
```

**Solution:**
- Simplify the agent prompt
- Increase timeout in configuration
- Check network connectivity

#### Missing Claude CLI
```
FileNotFoundError: [Errno 2] No such file or directory: 'claude'
```

**Solution:**
```bash
# Install Claude CLI
curl -sSL https://claude.ai/cli/install.sh | bash

# Verify installation
claude --version

# Configure settings
claude configure
```

#### Permission Errors
```
PermissionError: [Errno 13] Permission denied: '/Users/bobbobby/repos/VoiceTree/.claude/settings.json'
```

**Solution:**
```bash
# Fix permissions
chmod 644 /Users/bobbobby/repos/VoiceTree/.claude/settings.json

# Or run with proper permissions
sudo python run_tests.py
```

#### Invalid Test Scenarios
```
❌ Scenario 'Non-existent Test' not found
```

**Solution:**
```bash
# List available scenarios
python run_tests.py --list

# Use exact scenario name
python run_tests.py --scenario "Simple Progress Node Creation"
```

## Performance Optimization Examples

### Example 11: Optimizing Test Execution

**Reduce Test Execution Time:**

```python
# Optimize test scenarios for speed
{
  "name": "Quick Validation Test",
  "agent_prompt": "Create a simple progress node with minimal content:\n\n## Summary\nQuick test completed.\n\n## Technical Details\n- Basic validation\n\n## Simple Diagram\n```mermaid\nflowchart LR\n    A --> B\n```\n\n## Impact\nValidates basic functionality quickly.",
  "expected_behaviors": ["create_progress_node"]
}
```

**Parallel Testing (Future Enhancement):**
```python
# Concept for parallel test execution
import concurrent.futures

def run_tests_parallel(scenarios):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(lab.run_test_scenario, scenario['name'], ...)
            for scenario in scenarios
        ]
        
        results = [future.result() for future in futures]
    return results
```

## Integration Examples

### Example 12: CI/CD Integration

**GitHub Actions Workflow:**
```yaml
name: Agent Test Lab
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-agents:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
          
      - name: Install Claude CLI
        run: |
          curl -sSL https://claude.ai/cli/install.sh | bash
          echo "$HOME/.local/bin" >> $GITHUB_PATH
          
      - name: Configure Claude
        env:
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
        run: |
          claude configure --api-key "$CLAUDE_API_KEY"
          
      - name: Run Test Lab
        run: |
          cd tools/test_lab
          python run_tests.py
          
      - name: Upload Test Reports
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-reports
          path: test_results_*.json
```

### Example 13: Integration with Development Workflow

**Pre-commit Hook:**
```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running agent test lab..."
cd tools/test_lab

# Run quick validation tests only
python run_tests.py --scenario "Simple Progress Node Creation"

if [ $? -ne 0 ]; then
    echo "❌ Agent tests failed. Commit aborted."
    exit 1
fi

echo "✅ Agent tests passed."
```

**Makefile Integration:**
```makefile
# Makefile
.PHONY: test-agents test-agents-quick test-agents-full

test-agents: test-agents-quick

test-agents-quick:
	cd tools/test_lab && python run_tests.py --scenario "Simple Progress Node Creation"

test-agents-full:
	cd tools/test_lab && python run_tests.py

test-agents-report:
	cd tools/test_lab && python run_tests.py && \
	echo "Latest report:" && \
	ls -la test_results_*.json | tail -1
```

These examples demonstrate the comprehensive capabilities of the VoiceTree Test Lab system and provide practical guidance for various usage scenarios.