# VoiceTree Agentic Workflows - Clean Architecture

This module has been restructured to provide a **clean separation between agent abstraction and execution infrastructure**.

## Architecture Overview

```
agentic_workflows/
├── agent/                    # 🏗️ CORE: Pure Agent Definition
│   ├── __init__.py          
│   ├── definition.py         # Agent specification (nodes + edges + prompts)
│   └── prompts/              # Prompt templates only
│       ├── segmentation.txt
│       ├── relationship_analysis.txt
│       ├── integration_decision.txt  
│       └── node_extraction.txt
├── infrastructure/           # ⚙️ AUXILIARY: Execution Tools
│   ├── __init__.py
│   ├── executor.py           # Executes agents using infrastructure
│   ├── llm_integration.py    # LLM calls and integration
│   ├── state_manager.py      # State management
│   ├── debug_logger.py       # Debugging and logging
│   └── visualizer.py         # Workflow visualization
├── clean_main.py            # 🚀 Clean pipeline example
└── main.py                  # 🔄 Legacy compatibility
```

## Key Principles

### 1. 🏗️ Core Agent Abstraction (agent/)

**What it contains:**
- **Workflow definition ONLY** - nodes, edges, transitions
- **Prompt specifications** - template files and loading
- **Data flow mapping** - inputs/outputs between stages
- **Pure declarative specification** - no execution logic

**What it does NOT contain:**
- No LLM calls or integration
- No state management  
- No debugging or logging
- No execution infrastructure

**Example:**
```python
from agentic_workflows.agent import VoiceTreeAgent

# Pure agent definition - no infrastructure dependencies
agent = VoiceTreeAgent()
print(f"Stages: {len(agent.stages)}")
print(f"Transitions: {len(agent.transitions)}")

# Get the complete workflow specification
spec = agent.get_dataflow_spec()
```

### 2. ⚙️ Execution Infrastructure (infrastructure/)

**What it contains:**
- **Agent executor** - runs agent definitions
- **LLM integration** - handles LLM calls and responses
- **State management** - persistent state across executions
- **Debug logging** - execution tracing and debugging
- **Visualization** - workflow diagrams and analysis

**What it does NOT contain:**
- No agent workflow definitions
- No prompt templates
- No business logic about the specific agent

**Example:**
```python
from agentic_workflows.infrastructure import AgentExecutor

# Infrastructure handles execution
executor = AgentExecutor(agent)
result = executor.execute(initial_state)
```

### 3. 🚀 Clean Pipeline Usage

```python
from agentic_workflows import CleanVoiceTreePipeline

# Clean separation in action
pipeline = CleanVoiceTreePipeline()

# Agent definition is separate from execution
agent_spec = pipeline.inspect_agent()
print(f"Agent has {len(agent_spec['stages'])} stages")

# Infrastructure handles execution
result = pipeline.run("Hello world transcript")
```

## Benefits of This Architecture

### ✅ Clear Separation of Concerns
- **Agent definition** is pure and declarative
- **Infrastructure** is modular and reusable
- Easy to understand what each part does

### ✅ Easy Testing
- Test agent definition separately (no infrastructure needed)
- Test infrastructure separately (with mock agents)
- Integration tests use both together

### ✅ Simple Modifications
- Change agent workflow without touching infrastructure
- Change infrastructure without touching agent logic
- Add new agents easily using existing infrastructure

### ✅ Reduced Complexity
- No more mixed imports and complex fallbacks
- Clean dependency graph
- Each module has a single responsibility

## Migration Guide

### Before (Messy)
```python
# Everything mixed together
from agentic_workflows.nodes import segmentation_node
from agentic_workflows.graph import compile_voicetree_graph  
from agentic_workflows.main import VoiceTreePipeline

# Complex imports, mixed concerns
```

### After (Clean)
```python
# Clean separation
from agentic_workflows.agent import VoiceTreeAgent
from agentic_workflows.infrastructure import AgentExecutor
from agentic_workflows import CleanVoiceTreePipeline

# Clear responsibilities, easy to understand
```

## Usage Examples

### Inspect Agent Definition
```python
agent = VoiceTreeAgent()

# See all stages
for stage in agent.stages:
    print(f"{stage.id}: {stage.input_keys} → {stage.output_key}")

# See all transitions  
for transition in agent.transitions:
    print(f"{transition.from_stage} --{transition.condition}--> {transition.to_stage}")
```

### Execute with Infrastructure
```python
executor = AgentExecutor(agent)
result = executor.execute({
    "transcript_text": "My transcript...",
    "existing_nodes": "Node context..."
})

# Get execution summary
summary = executor.get_execution_summary()
print(f"Executed {summary['stages_executed']} stages")
```

### Use Clean Pipeline
```python
pipeline = CleanVoiceTreePipeline("state.json")
result = pipeline.run("My transcript text")

# Visualize the workflow
mermaid_diagram = pipeline.visualize_workflow()
print(mermaid_diagram)
```

## File Responsibilities

### agent/definition.py
- `VoiceTreeAgent` class - pure workflow specification
- `AgentStage` and `AgentTransition` data classes
- Helper functions for backward compatibility
- **Zero infrastructure dependencies**

### infrastructure/executor.py  
- `AgentExecutor` class - executes agent definitions
- Stage execution logic
- Transition logic and error handling
- **Requires agent definition to work**

### infrastructure/llm_integration.py
- LLM calling functions
- Response parsing and validation
- **No knowledge of specific agents**

### Legacy Compatibility

The old interface still works for backward compatibility:

```python
# Old way still works
from agentic_workflows import VoiceTreePipeline, run_voicetree_pipeline

pipeline = VoiceTreePipeline()  # Uses legacy implementation
result = run_voicetree_pipeline("transcript")  # Legacy function
```

But new code should use the clean architecture:

```python
# New clean way
from agentic_workflows import CleanVoiceTreePipeline

pipeline = CleanVoiceTreePipeline()  # Uses clean architecture
result = pipeline.run("transcript")
``` 