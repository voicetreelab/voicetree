# Available Agents

## VoiceTreeAgent

Processes voice transcripts into structured knowledge nodes.

```python
from agents.voice_tree import VoiceTreeAgent

# Create and run agent
agent = VoiceTreeAgent()
result = agent.run(
    transcript="I'm working on a new AI project...",
    existing_nodes="Previous knowledge about projects"
)

# Result contains:
# - chunks: Segmented ideas
# - analyzed_chunks: Relationships found  
# - integration_decisions: CREATE/APPEND actions
# - new_nodes: Extracted node names
```

### Workflow:
1. **Segmentation** → breaks transcript into atomic ideas
2. **Relationship Analysis** → finds connections to existing nodes
3. **Integration Decision** → decides CREATE or APPEND

### Adding New Agents

Create a new file in `agents/` folder:

```python
class MyAgent(Agent):
    def __init__(self):
        super().__init__("MyAgent", MyStateSchema)
        self._setup_workflow()
        
    def _setup_workflow(self):
        self.add_prompt("step1", "template", OutputSchema)
        self.add_dataflow("step1", END)
        
    def run(self, **inputs):
        # Agent handles everything
        return self.compile().invoke(inputs)
```