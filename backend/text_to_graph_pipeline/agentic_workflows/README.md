# Agentic Workflows

Clean agent-based implementation of VoiceTree's text-to-graph pipeline.

## Architecture

```mermaid
graph TB
    subgraph "Public API"
        subgraph "agents/"
            VTA[VoiceTreeAgent<br/>• Segmentation<br/>• Relationship Analysis<br/>• Integration Decision]
            FutureAgents[Future Agents<br/>• TreeReorgAgent<br/>• RewriterAgent<br/>• etc.]
        end
        
        subgraph "prompts/"
            Prompts[Prompt Templates<br/>• segmentation.md<br/>• relationship_analysis.md<br/>• integration_decision.md]
        end
        
        Models[models.py<br/>• SegmentationResponse<br/>• RelationshipResponse<br/>• IntegrationResponse]
        
    end
    
    subgraph "Hidden Implementation (core/)"
        Agent[agent.py<br/>Base Agent Class]
        State[state.py<br/>VoiceTreeState]
        LLM[llm_integration.py<br/>LLM Calls]
        PE[prompt_engine.py<br/>Template Loading]
        SM[state_manager.py<br/>Persistence]
        DL[debug_logger.py<br/>Debug Utils]
    end
    
    subgraph "External Systems"
        WA[workflow_adapter.py]
        CP[chunk_processor.py]
        Tests[Tests]
    end
    
    %% Agent Definition Flow
    VTA -->|inherits| Agent
    VTA -->|loads| Prompts
    VTA -->|uses schemas| Models
    
    %% Agent Execution Flow
    Agent -->|loads prompts via| PE
    Agent -->|calls LLM via| LLM
    Agent -->|validates with| State
    
    %% External Integration
    WA -->|uses| VTA
    WA -->|manages| SM
    
    %% Direct Usage
    Tests -.->|can use directly| VTA
    CP -->|imports| Models
    
    %% Styling
    classDef publicAPI fill:#e1f5e1,stroke:#4caf50,stroke-width:2px
    classDef hiddenImpl fill:#fff3e0,stroke:#ff9800,stroke-width:1px,stroke-dasharray: 5 5
    classDef external fill:#e3f2fd,stroke:#2196f3,stroke-width:2px
    
    class VTA,FutureAgents,Prompts,Models publicAPI
    class Agent,State,LLM,PE,SM,DL hiddenImpl
    class WA,CP,Tests external
```

## Structure

```
agentic_workflows/
├── agents/          # Agent definitions (what you use)
│   └── voice_tree.py
├── prompts/         # Prompt templates
├── core/            # Implementation details (hidden complexity)
└── models.py        # Data schemas
```

## Usage

```python
from agents.voice_tree import VoiceTreeAgent

# Create and run agent directly
agent = VoiceTreeAgent()
result = agent.run("Voice transcript text...")
```

## Key Concepts

- **Agents** = Prompts + Dataflow
- **Prompts** = Processing steps with templates
- **Dataflow** = How data moves between prompts

See `agents/README.md` for available agents.