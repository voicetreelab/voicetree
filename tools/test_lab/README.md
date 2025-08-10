# VoiceTree End-to-End Test Lab

A comprehensive testing framework for validating agent orchestration and node creation in the VoiceTree system. This test lab enables automated testing of the complete agent lifecycle from task initiation through subtask creation to output validation.

## Overview

The End-to-End Test Lab provides:
- **Headless Agent Execution**: Run agents in isolated environments without manual intervention
- **Comprehensive Validation**: Verify node creation, linking, formatting, and content quality
- **Multiple Test Scenarios**: Pre-configured scenarios covering various agent behaviors
- **Detailed Reporting**: Generate comprehensive test reports with pass/fail analysis

## Quick Start

### Prerequisites
- Python 3.8+
- Claude CLI installed and configured
- VoiceTree repository setup
- Access to `/Users/bobbobby/repos/VoiceTree` (or update paths in configuration)

### Installation
No additional installation required. The test lab uses only standard Python libraries and the existing VoiceTree environment.

### Basic Usage

Run all test scenarios:
```bash
cd /Users/bobbobby/repos/VoiceTree/tools/test_lab
python run_tests.py
```

Run a specific scenario:
```bash
python run_tests.py --scenario "Simple Progress Node Creation"
```

List available scenarios:
```bash
python run_tests.py --list
```

## Configuration

### Test Scenarios

Test scenarios are defined in `test_scenarios.json`. Each scenario includes:
- **name**: Unique identifier for the test
- **description**: Human-readable description
- **source_content**: Content for the dummy source note
- **agent_prompt**: Prompt sent to the agent
- **expected_behaviors**: List of expected agent behaviors
- **validation_criteria**: Specific validation rules

### Environment Configuration

The test lab uses these environment variables (automatically set during testing):
- `OBSIDIAN_VAULT_PATH`: Path to the test vault
- `OBSIDIAN_SOURCE_NOTE`: Relative path to source note
- `AGENT_COLOR`: Color assigned to the test agent

### Validation Rules

Default validation includes:
- **Node Creation**: New markdown files created
- **YAML Frontmatter**: Proper node_id, title, and color fields
- **Node ID Format**: Follows pattern `^\d+(_\d+)*$`
- **Parent-Child Links**: Proper `[[filename.md]]` linking
- **Content Structure**: Required sections (Summary, Technical Details, Impact)
- **Mermaid Diagrams**: Visual diagrams in code blocks
- **Filename Sanitization**: No invalid characters in filenames

## Command Line Options

### run_tests.py Options

```bash
python run_tests.py [OPTIONS]

Options:
  --scenario TEXT     Run specific test scenario by name
  --list             List available test scenarios  
  --config TEXT      Test scenarios configuration file (default: test_scenarios.json)
  --verbose, -v      Verbose output
  --help             Show help message
```

### Examples

Run with verbose output:
```bash
python run_tests.py --verbose
```

Use custom configuration:
```bash
python run_tests.py --config my_scenarios.json
```

Run specific scenario with verbose output:
```bash
python run_tests.py --scenario "Agent Subtask Creation" --verbose
```

## Test Scenarios

### Built-in Scenarios

1. **Simple Progress Node Creation**
   - Tests basic node creation with proper formatting
   - Validates YAML frontmatter, Mermaid diagrams, content structure

2. **Agent Subtask Creation**
   - Tests orchestration agent creating multiple subtasks
   - Validates multiple node creation and proper linking

3. **Error Handling Test**
   - Tests agent behavior with invalid inputs
   - Validates graceful error handling and filename sanitization

4. **Cross-Agent Communication Test**
   - Tests agents referencing other agents' work
   - Validates collaborative content and attribution

5. **Complex Technical Documentation**
   - Tests comprehensive documentation with multiple diagram types
   - Validates flowcharts, sequence diagrams, and class diagrams

### Adding Custom Scenarios

Add new scenarios to `test_scenarios.json`:

```json
{
  "name": "My Custom Test",
  "description": "Description of what this tests",
  "source_content": "Content for the dummy source note",
  "agent_prompt": "Prompt to send to the agent",
  "expected_behaviors": ["behavior1", "behavior2"],
  "validation_criteria": {
    "new_nodes_created": true,
    "proper_node_ids": true,
    "custom_validation": true
  }
}
```

## Output and Reporting

### Test Execution Output

During test execution, you'll see:
- Real-time progress updates
- Individual scenario results
- Validation results for each test
- Agent output (truncated for readability)
- Overall pass/fail status

### Test Reports

After execution, a JSON report is generated containing:
- Test run timestamp
- Individual test results and timings
- Validation details for each scenario
- Error messages and debugging information

Report location: `/Users/bobbobby/repos/VoiceTree/test_results_TIMESTAMP.json`

### Reading Test Results

```python
import json

# Load test report
with open('test_results_20250808_143022.json', 'r') as f:
    report = json.load(f)

# Check overall results
print(f"Total tests: {report['total_tests']}")
print(f"Passed: {report['passed_tests']}")

# Examine specific test
test = report['test_results'][0]
print(f"Test: {test['prompt'][:50]}...")
print(f"Status: {test['status']}")
print(f"Validations: {test['validations']}")
```

## Troubleshooting

### Common Issues

**Test fails with "claude command not found"**
- Ensure Claude CLI is installed and in your PATH
- Verify Claude settings exist at `/Users/bobbobby/repos/VoiceTree/.claude/settings.json`

**Tests timeout after 120 seconds**
- Check if your prompts are too complex
- Verify network connectivity for LLM requests
- Consider increasing timeout in `end_to_end_test_runner.py`

**No nodes created during test**
- Check agent prompt includes instructions to use `add_new_node.py`
- Verify vault path is correctly set
- Check agent has proper permissions

**Validation failures**
- Review validation criteria in test scenarios
- Check that agents are following content format requirements
- Verify Mermaid diagrams are properly formatted

### Debug Mode

For detailed debugging, examine:
1. Agent stdout/stderr in test results
2. Temporary test vault contents (before cleanup)
3. Claude execution environment variables

### Enable Debug Output

Modify `end_to_end_test_runner.py` to skip cleanup:
```python
def cleanup_test_environment(self):
    # Comment out for debugging
    # if self.test_vault_root and self.test_vault_root.exists():
    #     shutil.rmtree(self.test_vault_root)
    pass
```

### Performance Issues

**Slow test execution:**
- Reduce number of test scenarios
- Use smaller, more focused prompts
- Check system resources during execution

**High memory usage:**
- Monitor test vault cleanup
- Verify no memory leaks in agent execution
- Consider running tests sequentially rather than in parallel

## Integration

### CI/CD Integration

See `charlie_create_cicd_integration.md` for GitHub Actions integration.

### Custom Validation

Extend `output_validator.py` for custom validation rules:

```python
from output_validator import AgentOutputValidator

class CustomValidator(AgentOutputValidator):
    def validate_custom_requirement(self, content):
        # Your custom validation logic
        return True  # or False
```

### Programmatic Usage

```python
from end_to_end_test_runner import EndToEndTestLab

# Create test lab
lab = EndToEndTestLab()

# Run custom test
success = lab.run_test_scenario(
    "My Test",
    "Source content",
    "Agent prompt",
    ["expected_behavior"]
)

# Generate report
report_file = lab.generate_test_report()
```

## Contributing

When adding new test scenarios:
1. Follow existing naming conventions
2. Include comprehensive validation criteria
3. Test scenarios should be independent
4. Document expected behaviors clearly
5. Ensure scenarios cover edge cases

## Support

For issues with the test lab:
1. Check the troubleshooting section above
2. Review test logs and reports
3. Examine agent output for error patterns
4. Verify environment configuration

## Version Information

- **Test Lab Version**: 1.0
- **Compatible with**: VoiceTree Agent System v2.0+
- **Python Requirements**: 3.8+
- **Claude CLI**: Latest version recommended