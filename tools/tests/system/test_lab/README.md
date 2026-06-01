# VoiceTree End-to-End Test Lab

Automated testing framework for the VoiceTree agent lifecycle: task initiation → subtask creation → output validation. See `ARCHITECTURE.md` for design details.

## Quick Start

### Prerequisites
- Python 3.8+
- Claude CLI installed and configured
- VoiceTree repository setup

### Usage

```bash
cd tools/tests/system/test_lab
python3 run_tests.py                                    # all scenarios
python3 run_tests.py --scenario "Simple Progress Node Creation"
python3 run_tests.py --list                             # list scenarios
python3 run_tests.py --verbose                          # full output
python3 run_tests.py --help                             # all options
```

## Configuration

Test scenarios are defined in `test_scenarios.json`. Each scenario specifies:
- `name` — unique identifier
- `description` — human-readable purpose
- `source_content` — content for the dummy source note
- `agent_prompt` — prompt sent to the agent
- `expected_behaviors` — list of expected behaviors
- `validation_criteria` — validation rules

### Environment variables (set automatically during test runs)
- `OBSIDIAN_PROJECT_PATH` — path to the test project
- `OBSIDIAN_SOURCE_NOTE` — relative path to the source note
- `AGENT_COLOR` — color assigned to the test agent

### Default validation rules
Node creation, YAML frontmatter (`node_id`, `title`, `color`), node ID pattern
`^\d+(_\d+)*$`, parent-child wikilinks, content structure (Summary / Technical Details /
Impact), Mermaid diagrams, and filename sanitization.

## Built-in Scenarios

1. **Simple Progress Node Creation** — basic node creation with proper formatting
2. **Agent Subtask Creation** — orchestrator creating linked subtasks
3. **Error Handling Test** — graceful behavior on invalid inputs
4. **Cross-Agent Communication Test** — agents referencing other agents' work
5. **Complex Technical Documentation** — flowcharts, sequence and class diagrams

### Adding scenarios

Append a JSON object to `test_scenarios.json` with the fields listed above; see the
existing entries as templates.

## Reports

Each run writes `test_results_TIMESTAMP.json` at the repo root with per-scenario
results, validation details, agent output, and timings. Load with `json.load` and
inspect `report['test_results']`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `claude command not found` | Claude CLI not on `PATH`, or `.claude/settings.json` missing |
| Tests time out (120s) | Prompt too complex, network slow, or timeout too tight in `end_to_end_test_runner.py` |
| No nodes created | Agent prompt missing `add_new_node.py` instructions, project path wrong, or insufficient permissions |
| Validation fails | Mismatch between scenario `validation_criteria` and agent output format |

For deeper debugging, comment out `shutil.rmtree(self.test_project_root)` in
`cleanup_test_environment` to inspect the temporary project after a run.

## Extending validation

Subclass `AgentOutputValidator` in `output_validator.py` and add custom
`validate_*` methods. Custom validators are picked up by name from the scenario's
`validation_criteria` block.

## Programmatic usage

```python
from end_to_end_test_runner import EndToEndTestLab

lab = EndToEndTestLab()
success = lab.run_test_scenario(
    "My Test", "Source content", "Agent prompt", ["expected_behavior"]
)
report_file = lab.generate_test_report()
```

## CI/CD

See `charlie_create_cicd_integration.md` for GitHub Actions integration.
