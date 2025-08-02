
Make sure to run the relevant agent tests at backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests

These tests actually call the LLM live, to ensure the behaviour is actually what we expect.

If possible prefer running the single prompt tests,  

e.g. for identify target:
backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/AppendToRelevantNodeAgent/identify_target_node/test_identify_target_node_hard.py

or for optimizer:
backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/test_single_abstraction_optimizer_prompt.py

Then, once you are sure the prompt is working well:

2. Run the agent tests

Then 3. Run the workflow test, i.e. whatever calls this agent, should have a test for itself, where the response from the agent
is MOCKED, and it just ensures input/output behaviour for the integration module (workflow driver)