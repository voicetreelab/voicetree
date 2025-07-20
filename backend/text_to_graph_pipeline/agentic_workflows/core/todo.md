Keep on getting errors like this:

```
❌ Error calling Gemini API: 1 validation error for _GeminiResponse
candidates.0.finishReason
  Input should be 'STOP', 'MAX_TOKENS' or 'SAFETY' [type=literal_error, input_value='MALFORMED_FUNCTION_CALL', input_type=str]
    For further information visit https://errors.pydantic.dev/2.11/v/literal_error
📝 Validation error details: The LLM response didn't match expected schema for single_abstraction_optimizer
   Expected schema: OptimizationResponse
Buffer full, sending to agentic workflow, text:  Um, and then I want to understand the engineering problem better of how we can stream audio files, uh, and how, how we send these audio files because currently they need to be atomic files, but that's not really how our app is structured. The voice is, uh, you know, it's it's continuous. 

2025-07-20 15:23:18,737 - root - ERROR - Error in process_and_convert: ❌ Error calling Gemini API: 1 validation error for _GeminiResponse
candidates.0.finishReason
  Input should be 'STOP', 'MAX_TOKENS' or 'SAFETY' [type=literal_error, input_value='MALFORMED_FUNCTION_CALL', input_type=str]
    For further information visit https://errors.pydantic.dev/2.11/v/literal_error
Please check your API configuration and try again. - Type: <class 'RuntimeError'> - Traceback: Traceback (most recent call last):
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/agentic_workflows/core/llm_integration.py", line 170, in call_llm_structured
    result = await agent.run(prompt)
             ^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_ai/agent.py", line 316, in run
    async for _ in agent_run:
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_ai/agent.py", line 1366, in __anext__
    next_node = await self._graph_run.__anext__()
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_graph/graph.py", line 782, in __anext__
    return await self.next(self._next_node)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_graph/graph.py", line 760, in next
    self._next_node = await node.run(ctx)
                      ^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_ai/_agent_graph.py", line 252, in run
    return await self._make_request(ctx)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_ai/_agent_graph.py", line 304, in _make_request
    model_response, request_usage = await ctx.deps.model.request(
                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic_ai/models/gemini.py", line 176, in request
    response = _gemini_response_ta.validate_json(await http_response.aread())
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/pydantic/type_adapter.py", line 468, in validate_json
    return self.validator.validate_json(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
pydantic_core._pydantic_core.ValidationError: 1 validation error for _GeminiResponse
candidates.0.finishReason
  Input should be 'STOP', 'MAX_TOKENS' or 'SAFETY' [type=literal_error, input_value='MALFORMED_FUNCTION_CALL', input_type=str]
    For further information visit https://errors.pydantic.dev/2.11/v/literal_error

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py", line 98, in process_new_text_and_update_markdown
    await self.process_new_text(text)
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py", line 131, in process_new_text
    updated_nodes = await self.workflow.process_text_chunk(
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/chunk_processing_pipeline/tree_action_decider_workflow.py", line 226, in process_text_chunk
    optimization_actions: List[BaseTreeAction] = await self.optimizer_agent.run(
                                                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/agentic_workflows/agents/single_abstraction_optimizer_agent.py", line 61, in run
    result = await app.ainvoke(initial_state)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/langgraph/pregel/__init__.py", line 2850, in ainvoke
    async for chunk in self.astream(
  File "/Users/bobbobby/repos/VoiceTreePoc/.venv/lib/python3.11/site-packages/langgraph/pregel/__init__.py", line 2732, in astream
    async for _ in runner.atick(
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/agentic_workflows/core/agent.py", line 111, in node_fn
    response = await call_llm_structured(prompt, pname, output_schema=output_schema)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/agentic_workflows/core/llm_integration.py", line 178, in call_llm_structured
    _handle_llm_error(e, stage_type, output_schema)
  File "/Users/bobbobby/repos/VoiceTreePoc/backend/text_to_graph_pipeline/agentic_workflows/core/llm_integration.py", line 124, in _handle_llm_error
    raise RuntimeError(f"{error_msg}\nPlease check your API configuration and try again.")
RuntimeError: ❌ Error calling Gemini API: 1 validation error for _GeminiResponse
candidates.0.finishReason
  Input should be 'STOP', 'MAX_TOKENS' or 'SAFETY' [type=literal_error, input_value='MALFORMED_FUNCTION_CALL', input_type=str]
    For further information visit https://errors.pydantic.dev/2.11/v/literal_error
Please check your API configuration and try again.
During task with name 'single_abstraction_optimizer' and id '18c1b0ff-b6a1-d2af-0d0c-41b41d08254d'
```

Let's address this by getting rid of the pydantic-ai wrapper around gemini, and just use their raw genai client: 


Examples:

```
from google import genai

import enum
from pydantic import BaseModel

class Grade(enum.Enum):
    A_PLUS = "a+"
    A = "a"
    B = "b"
    C = "c"
    D = "d"
    F = "f"

class Recipe(BaseModel):
  recipe_name: str
  rating: Grade

client = genai.Client()
response = client.models.generate_content(
    model='gemini-2.5-flash',
    contents='List 10 home-baked cookie recipes and give them grades based on tastiness.',
    config={
        'response_mime_type': 'application/json',
        'response_schema': list[Recipe],
    },
)

print(response.text)
```

Note, we still using Gemini and Pydantic models, just not pydantic-ai for llm_integration.py