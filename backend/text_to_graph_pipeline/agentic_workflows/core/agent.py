"""
Clean agent abstraction that matches the mental model:
- Agent = container with identity
- Prompts = the processing steps
- Dataflow = how data transforms between prompts
"""

from typing import Dict, Any, List, Type, Callable, Optional, Tuple
from pydantic import BaseModel
from langgraph.graph import StateGraph, END


class Agent:
    """An agent is defined by its prompts and how data flows between them"""
    
    def __init__(self, name: str, state_schema: Type[BaseModel]):
        """
        Initialize an agent
        
        Args:
            name: Agent identifier
            state_schema: Pydantic model defining the state structure
        """
        self.name = name
        self.state_schema = state_schema
        self.prompts: Dict[str, str] = {}  # name -> prompt template
        self.output_schemas: Dict[str, Type[BaseModel]] = {}  # name -> pydantic schema
        self.dataflows: List[Tuple[str, str, Optional[Callable]]] = []  # (from, to, transform)
        self.entry_point: Optional[str] = None
        
    def add_prompt(self, name: str, output_schema: Type[BaseModel]):
        """
        Define a prompt step in the agent
        
        Args:
            name: Unique identifier for this prompt (also used as template filename)
            output_schema: Pydantic model for structured output
        """
        self.prompts[name] = name  # Name is the template filename
        self.output_schemas[name] = output_schema
        
        # First prompt becomes entry point by default
        if self.entry_point is None:
            self.entry_point = name
            
    def add_dataflow(self, from_prompt: str, to_prompt: str, 
                     transform: Optional[Callable[[Dict], Dict]] = None):
        """
        Define how data flows from one prompt to another
        
        Args:
            from_prompt: Source prompt name
            to_prompt: Target prompt name (or END)
            transform: Optional function to transform state between prompts
        """
        if from_prompt not in self.prompts and from_prompt != self.entry_point:
            raise ValueError(f"Unknown source prompt: {from_prompt}")
        if to_prompt not in self.prompts and to_prompt != END:
            raise ValueError(f"Unknown target prompt: {to_prompt}")
            
        self.dataflows.append((from_prompt, to_prompt, transform))
        
    def set_entry_point(self, prompt_name: str):
        """Override the default entry point"""
        if prompt_name not in self.prompts:
            raise ValueError(f"Unknown prompt: {prompt_name}")
        self.entry_point = prompt_name
        
    def compile(self, llm_client=None) -> Any:
        """
        Convert to LangGraph for execution
        
        Args:
            llm_client: LLM client to use for prompt execution
            
        Returns:
            Compiled LangGraph
        """
        from .llm_integration import call_llm_structured
        from .prompt_engine import PromptLoader
        from pathlib import Path
        
        # Create the graph
        graph = StateGraph(self.state_schema)
        
        # Create prompt loader
        prompt_loader = PromptLoader(Path(__file__).parent.parent / "prompts")
        
        # Add each prompt as a node
        for prompt_name in self.prompts:
            
            def make_node_fn(pname: str):  # Closure to capture prompt_name
                async def node_fn(state: Dict[str, Any]) -> Dict[str, Any]:
                    from .debug_logger import log_stage_input_output
                    
                    # Log inputs
                    debug_inputs = dict(state)
                    
                    # Get the prompt template
                    template = self.prompts[pname]
                    
                    # Template is always a filename now
                    prompt = prompt_loader.render_template(template, **state)
                    
                    # Call LLM with structured output
                    output_schema = self.output_schemas[pname]
                    if llm_client:
                        response = llm_client.call(prompt, output_schema=output_schema)
                    else:
                        # Use default integration
                        response = await call_llm_structured(prompt, pname, output_schema=output_schema)
                    
                    # Convert response to dict if needed
                    if hasattr(response, 'model_dump'):
                        response_dict = response.model_dump()
                    else:
                        response_dict = response
                    
                    # Log outputs
                    debug_outputs = {
                        **response_dict,
                        "current_stage": pname + "_complete"
                    }
                    log_stage_input_output(pname, debug_inputs, debug_outputs)
                        
                    # Update state with response
                    return {
                        **state,
                        **response_dict,
                        "current_stage": pname + "_complete"
                    }
                    
                return node_fn
                
            graph.add_node(prompt_name, make_node_fn(prompt_name))
            
        # Add dataflows as edges
        for from_prompt, to_prompt, transform in self.dataflows:
            if transform:
                # Create an intermediate transformer node
                transformer_name = f"{from_prompt}_to_{to_prompt}_transform"
                
                def make_transformer(t: Callable, from_p: str, to_p: str):
                    async def transformer_node(state: Dict[str, Any]) -> Dict[str, Any]:
                        # Debug logging for transformer
                        from .debug_logger import log_stage_input_output
                        transformer_name_local = f"{from_p}_to_{to_p}_transform"
                        
                        # Log what we receive
                        print(f"\nDEBUG: Transformer {transformer_name_local} received state:")
                        print(f"  - current_stage: {state.get('current_stage')}")
                        print(f"  - has chunks: {'chunks' in state and state['chunks'] is not None}")
                        if 'chunks' in state and state['chunks'] is not None:
                            print(f"  - chunks count: {len(state['chunks'])}")
                        
                        result = t(state)
                        log_stage_input_output(transformer_name_local, state, result)
                        return result
                    return transformer_node
                    
                graph.add_node(transformer_name, make_transformer(transform, from_prompt, to_prompt))
                graph.add_edge(from_prompt, transformer_name)
                graph.add_edge(transformer_name, to_prompt if to_prompt != END else END)
            else:
                # Direct edge
                graph.add_edge(from_prompt, to_prompt if to_prompt != END else END)
                
        # Set entry point
        if self.entry_point:
            graph.set_entry_point(self.entry_point)
            
        return graph.compile()
        
    def visualize(self) -> str:
        """
        Return a simple text visualization of the agent's workflow
        """
        lines = [f"Agent: {self.name}", "=" * (len(self.name) + 7), ""]
        
        # Show prompts
        lines.append("Prompts:")
        for name in self.prompts:
            schema_name = self.output_schemas[name].__name__
            marker = "→" if name == self.entry_point else " "
            lines.append(f"  {marker} {name} ({schema_name})")
            
        lines.append("")
        
        # Show dataflow
        lines.append("Dataflow:")
        for from_p, to_p, transform in self.dataflows:
            transform_str = f" [transform: {transform.__name__}]" if transform else ""
            to_str = "END" if to_p == END else to_p
            lines.append(f"  {from_p} → {to_str}{transform_str}")
            
        return "\n".join(lines)