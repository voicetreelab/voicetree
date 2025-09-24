## Project Overview

VoiceTree is a system which does online text stream to "abstraction graphs" conversion. An abstraction graph (or concept graph) is a collection of markdown notes, connected to each other via markdown links. Each note represents an abstraction/concept present in the text.

Key files:

- Driver for taking a full chunk of text, getting the resulting tree node actions (create, append, update), and executing them: backend/text_to_graph_pipeline/chunk_processing_pipeline/tree_action_decider_workflow.py
- Agents: backend/text_to_graph_pipeline/agentic_workflows/agents
  - Prompts for agents: backend/text_to_graph_pipeline/agentic_workflows/prompts
- Tree data structure and functions: backend/markdown_tree_manager

## Essential Commands

# Run unit tests
uv run pytest backend/tests/unit_tests

# Run integration & system tests
uv run pytest backend/tests/integration_tests/

# Run benchmarker for quality testing
uv run python backend/benchmarker/src/quality_LLM_benchmarker.py

Rules:

use ripgrep for finding files, it is much faster than grep:
<rg example>
rg --files -g "*agent*"
</rg example>

## Development Philosophy

### VERY IMPORTANT Key Rules
1. **Single Solution Principle**: Never have more than 1 solution for the same problem. Instead, evolve the system incrementally towards the desired state. Never have fallbacks. Do not keep legacy or deprecated code in the codebase.
2. **Minimize Complexity**: When adding features, reduce complexity by re-architecting, introducing abstractions that hide complexity and separating concerns.
3. **Quality Testing**: Add high quality unit tests for any non-trivial changes. These will undergo mutation testing. However, keep the tests general enough that minor changes (non functional) don't break the unit tests. Make sure all added tests are providing real value, and not just overhead and complexity.
4. **Fail Fast**: No complex error handling during development

That means NO FALLBACKS, NO COMPLEX ERROR HANDLING. After proposing any solution, take a step back, and actively say to yourself that you will now think about whether there is a less complex alternative.

when planning a task that involves writing code:
  First research review the existing code. Think about the best way to structure the solution, such that it is simple, clean, follows best practices, and keeps our 
  architecture clean. Then propose the changes you will make, but ONLY at a high level, methods and inputs and their outputs. we will worry about 
  specific code later.

Please ask for clarifications if anything is unclear.

Use TDD. First write a test (or check existing test) and ensure it fails. Have a outline for the overall behaviour you are trying to test, just inputs and outputs for whatever method / class / module / system you are working on. Only then start developing the code. 